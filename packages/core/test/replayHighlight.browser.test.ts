import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firefox, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// The fake `createFakeContext` used by the rest of this suite is `vi.fn()`
// mocks with zero real WebGL semantics — it can't catch bugs in shader
// compilation, program linking, or uniform copying, which is exactly the
// logic `useHighlightShader`/`copyUniforms` live or die by. These tests
// instead drive that code against a real, compiled-and-linked WebGL2
// program running in an actual browser (headless Firefox on Xvfb + Mesa's
// llvmpipe software rasterizer — this container has no GPU).
//
// Requires system packages not installed via npm: Xvfb and a software GL
// stack (libgl1-mesa-dri et al.), plus `playwright install firefox`.

const DISPLAY = ':97';

let xvfb: ChildProcess;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', '64x64x24'], { stdio: 'ignore' });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  browser = await firefox.launch({
    headless: false, // "headless" Firefox has never reliably supported WebGL; a real (virtual) display does
    env: { ...process.env, DISPLAY, LIBGL_ALWAYS_SOFTWARE: '1' },
  });
  page = await browser.newPage();

  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundle = await build({
    entryPoints: [path.join(here, 'fixtures/browserEntry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'WGD',
    target: 'es2022',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  xvfb?.kill();
});

// Mirrors the shape of the real app's shaders closely enough to exercise the
// same code paths: #version 300 es, a position attribute, a vec2 uniform
// driving where geometry lands, a vec4 uniform driving its color.
const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
uniform vec2 uOffset;
void main() {
  gl_Position = vec4(aPosition + uOffset, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}`;

// Runs in the browser. Programs and VAOs often remain bound from before the
// captured frame, so none of these recorded calls bind either one again.
function replayPreboundFrames({ vertexSource, fragmentSource, steps }: {
  vertexSource: string;
  fragmentSource: string;
  steps: { context: number; target: 'a' | 'b' | 'uniform'; highlight: boolean }[];
}) {
  const WGDNS = (window as unknown as { WGD: typeof import('./fixtures/browserEntry.js') }).WGD;
  const contexts = Array.from({ length: Math.max(...steps.map((step) => step.context)) + 1 }, () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const gl = canvas.getContext('webgl2')!;
    const program = gl.createProgram()!;
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
      }
      gl.attachShader(program, shader);
    }
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
    }
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.1, -0.1, 0.1, -0.1, 0, 0.1]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    const registry = WGDNS.createObjectRegistry();
    const offsetLoc = gl.getUniformLocation(program, 'uOffset')!;
    const colorLoc = gl.getUniformLocation(program, 'uColor')!;
    const offsetRef = WGDNS.registerObject(registry, offsetLoc, 'WebGLUniformLocation');
    const colorRef = WGDNS.registerObject(registry, colorLoc, 'WebGLUniformLocation');
    const glObj = (id: number) => ({ kind: 'globject' as const, display: '', raw: { id } });
    const raw = (kind: string, value: unknown) => ({ kind: kind as never, display: '', raw: value });
    let nextId = 0;
    const call = (name: string, args: unknown[]) => ({
      id: nextId++, name, args: args as never[], result: undefined, timestamp: 0,
    });
    const calls = [
      call('clearColor', [raw('number', 0), raw('number', 0), raw('number', 0), raw('number', 1)]),
      call('clear', [raw('enum', gl.COLOR_BUFFER_BIT)]),
      call('uniform2fv', [glObj(offsetRef.id), raw('typedarray', [-0.5, 0])]),
      call('uniform4fv', [glObj(colorRef.id), raw('typedarray', [0, 1, 0, 1])]),
      call('drawArrays', [raw('enum', gl.TRIANGLES), raw('number', 0), raw('number', 3)]),
      call('uniform2fv', [glObj(offsetRef.id), raw('typedarray', [0.5, 0])]),
      call('uniform4fv', [glObj(colorRef.id), raw('typedarray', [0, 0, 1, 1])]),
      call('drawArrays', [raw('enum', gl.TRIANGLES), raw('number', 0), raw('number', 3)]),
    ];
    return { gl, program, colorLoc, registry, calls };
  });

  return steps.map(({ context, target, highlight }) => {
    const { gl, program, colorLoc, registry, calls } = contexts[context];
    const targetId = { a: 4, b: 7, uniform: 6 }[target];
    WGDNS.replayCalls(gl, calls, registry, targetId,
      highlight ? WGDNS.DRAW_CALL_DEBUG_MODE.HIGHLIGHT : WGDNS.DRAW_CALL_DEBUG_MODE.NONE);
    const pixel = (x: number) => {
      const data = new Uint8Array(4);
      gl.readPixels(x, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return Array.from(data);
    };
    return {
      left: pixel(16),
      right: pixel(48),
      originalProgramsBound: contexts.map(({ gl, program }) => gl.getParameter(gl.CURRENT_PROGRAM) === program),
      colorUniform: Array.from(gl.getUniform(program, colorLoc) as Float32Array),
      errors: contexts.map(({ gl }) => gl.getError()),
    };
  });
}

function replayVertexState({ declarations, position, uniforms, uniformBlocks = false, depthTest }: {
  declarations: string;
  position: string;
  uniforms: { name: string; method: string; args: unknown[] }[];
  uniformBlocks?: boolean;
  depthTest?: boolean;
}) {
  const WGDNS = (window as unknown as { WGD: typeof import('./fixtures/browserEntry.js') }).WGD;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const gl = canvas.getContext('webgl2')!;
  const program = gl.createProgram()!;
  const vertexSource = `#version 300 es
    in vec2 aPosition;
    ${declarations}
    ${depthTest === undefined ? '' : 'uniform float uDepth;'}
    void main() {
      gl_Position = vec4(${position}, ${depthTest === undefined ? '0.0' : 'uDepth'}, 1.0);
    }`;
  const fragmentSource = `#version 300 es
    precision mediump float;
    ${uniformBlocks ? 'layout(std140) uniform AColor { vec4 color; };' : ''}
    ${depthTest === undefined ? '' : 'uniform vec4 uColor;'}
    out vec4 fragColor;
    void main() { fragColor = ${uniformBlocks ? 'color' : depthTest === undefined ? 'vec4(0.0, 1.0, 0.0, 1.0)' : 'uColor'}; }`;
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    }
    gl.attachShader(program, shader);
  }
  gl.bindAttribLocation(program, 0, 'aPosition');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  }
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.1, -0.1, 0.1, -0.1, 0, 0.1]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  for (const { name, method, args } of uniforms) {
    const location = gl.getUniformLocation(program, name);
    if (!location) throw new Error(`Inactive test uniform: ${name}`);
    (gl as unknown as Record<string, (...args: unknown[]) => void>)[method](location, ...args);
  }

  let highlightBlockBinding = -1;
  if (uniformBlocks) {
    for (const [name, binding, values] of [
      ['AColor', 2, [0, 1, 0, 1]],
      ['ZTransform', 3, [0.5, 0, 0, 0]],
    ] as const) {
      const blockIndex = gl.getUniformBlockIndex(program, name);
      if (blockIndex === gl.INVALID_INDEX) throw new Error(`Inactive test uniform block: ${name}`);
      gl.uniformBlockBinding(program, blockIndex, binding);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
      gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, buffer);
    }
    const drawArrays = gl.drawArrays.bind(gl);
    gl.drawArrays = (...args) => {
      const currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
      const blockIndex = gl.getUniformBlockIndex(currentProgram, 'ZTransform');
      highlightBlockBinding = gl.getActiveUniformBlockParameter(currentProgram, blockIndex, gl.UNIFORM_BLOCK_BINDING);
      drawArrays(...args);
    };
  }

  const registry = WGDNS.createObjectRegistry();
  const raw = (value: number) => ({ kind: 'number' as const, display: '', raw: value });
  const calls = [
    { id: 0, name: 'clearColor', args: [0, 0, 0, 1].map(raw), result: undefined, timestamp: 0 },
    { id: 1, name: 'clear', args: [raw(gl.COLOR_BUFFER_BIT)], result: undefined, timestamp: 0 },
    { id: 2, name: 'drawArrays', args: [gl.TRIANGLES, 0, 3].map(raw), result: undefined, timestamp: 0 },
  ];
  const snapshots = [WGDNS.DRAW_CALL_DEBUG_MODE.NONE, WGDNS.DRAW_CALL_DEBUG_MODE.HIGHLIGHT].map((mode) => {
    if (depthTest !== undefined) {
      // Seed a front occluder; the selected draw then overlaps it farther away.
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(gl.getUniformLocation(program, 'uDepth'), -0.5);
      gl.uniform4fv(gl.getUniformLocation(program, 'uColor'), [0, 1, 0, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.uniform1f(gl.getUniformLocation(program, 'uDepth'), 0.5);
      gl.uniform4fv(gl.getUniformLocation(program, 'uColor'), [0, 0, 1, 1]);
      if (!depthTest) gl.disable(gl.DEPTH_TEST);
    }
    const frameCalls = depthTest === undefined ? calls : [{ ...calls[2], id: 0 }];
    WGDNS.replayCalls(gl, frameCalls, registry, frameCalls.length - 1, mode);
    const pixel = (x: number) => {
      const data = new Uint8Array(4);
      gl.readPixels(x, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return Array.from(data);
    };
    const snapshot = {
      right: pixel(48),
      center: pixel(32),
      originalProgramBound: gl.getParameter(gl.CURRENT_PROGRAM) === program,
    };
    if (depthTest !== undefined) {
      const depthTestEnabled = gl.isEnabled(gl.DEPTH_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return { ...snapshot, depthTestEnabled, afterOrdinaryDraw: pixel(48), error: gl.getError() };
    }
    return { ...snapshot, error: gl.getError() };
  });
  return { snapshots, highlightBlockBinding };
}

describe('replayCalls highlight overlay, against a real WebGL2 context', () => {
  it.each([true, false])('shows highlights through occluders and restores depth testing (%s)', async (depthTest) => {
    const { snapshots } = await page.evaluate(replayVertexState, {
      declarations: '',
      position: 'aPosition + vec2(0.5, 0.0)',
      uniforms: [],
      depthTest,
    });
    const ordinaryColor = depthTest ? [0, 255, 0, 255] : [0, 0, 255, 255];
    const magenta = [255, 0, 255, 255];
    const shared = { center: [0, 0, 0, 255], originalProgramBound: true, depthTestEnabled: depthTest, error: 0 };
    expect(snapshots).toEqual([
      { ...shared, right: ordinaryColor, afterOrdinaryDraw: ordinaryColor },
      { ...shared, right: magenta, afterOrdinaryDraw: depthTest ? magenta : ordinaryColor },
    ]);
  });

  it.each([
    {
      name: 'every scalar uniform array element',
      declarations: 'uniform float uScale[2];',
      position: 'aPosition * vec2(uScale[0], uScale[1]) + vec2(0.5, 0.0)',
      uniforms: [{ name: 'uScale[0]', method: 'uniform1fv', args: [[1, 1]] }],
    },
    {
      name: 'unsigned integer uniforms',
      declarations: 'uniform uint uRight;',
      position: 'aPosition + vec2(float(uRight) * 0.5, 0.0)',
      uniforms: [{ name: 'uRight', method: 'uniform1ui', args: [1] }],
    },
    {
      name: 'integer vector uniforms',
      declarations: 'uniform ivec2 uOffset;',
      position: 'aPosition + vec2(uOffset) * 0.5',
      uniforms: [{ name: 'uOffset', method: 'uniform2iv', args: [[1, 0]] }],
    },
    {
      name: 'non-square matrix uniforms',
      declarations: 'uniform mat2x3 uTransform;',
      position: '(uTransform * aPosition).xy + vec2(0.5, 0.0)',
      uniforms: [{ name: 'uTransform', method: 'uniformMatrix2x3fv', args: [false, [1, 0, 0, 0, 1, 0]] }],
    },
  ])('preserves vertex positions driven by $name', async ({ declarations, position, uniforms }) => {
    const { snapshots } = await page.evaluate(replayVertexState, { declarations, position, uniforms });
    expect(snapshots).toEqual([
      { right: [0, 255, 0, 255], center: [0, 0, 0, 255], originalProgramBound: true, error: 0 },
      { right: [255, 0, 255, 255], center: [0, 0, 0, 255], originalProgramBound: true, error: 0 },
    ]);
  });

  it('preserves nonzero uniform block bindings through shader replacement', async () => {
    const result = await page.evaluate(replayVertexState, {
      // The fragment-only AColor block disappears from the replacement,
      // so program-local block indices may also change with the new link.
      declarations: 'layout(std140) uniform ZTransform { vec4 offset; };',
      position: 'aPosition + offset.xy',
      uniforms: [],
      uniformBlocks: true,
    });
    expect(result.highlightBlockBinding).toBe(3);
    expect(result.snapshots).toEqual([
      { right: [0, 255, 0, 255], center: [0, 0, 0, 255], originalProgramBound: true, error: 0 },
      { right: [255, 0, 255, 255], center: [0, 0, 0, 255], originalProgramBound: true, error: 0 },
    ]);
  });

  it('restores a program bound before capture across reselection and disabling highlight', async () => {
    const result = await page.evaluate(replayPreboundFrames, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
      steps: [
        { context: 0, target: 'a' as const, highlight: true },
        { context: 0, target: 'b' as const, highlight: true },
        { context: 0, target: 'a' as const, highlight: true },
        { context: 0, target: 'b' as const, highlight: false },
      ],
    });
    const green = [0, 255, 0, 255];
    const blue = [0, 0, 255, 255];
    const magenta = [255, 0, 255, 255];
    const black = [0, 0, 0, 255];
    expect(result).toEqual([
      { left: magenta, right: black, originalProgramsBound: [true], colorUniform: [0, 1, 0, 1], errors: [0] },
      { left: green, right: magenta, originalProgramsBound: [true], colorUniform: [0, 0, 1, 1], errors: [0] },
      { left: magenta, right: black, originalProgramsBound: [true], colorUniform: [0, 1, 0, 1], errors: [0] },
      { left: green, right: blue, originalProgramsBound: [true], colorUniform: [0, 0, 1, 1], errors: [0] },
    ]);
  });

  it('leaves non-draw uniform updates on the original program when highlight is enabled', async () => {
    const result = await page.evaluate(replayPreboundFrames, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
      steps: [{ context: 0, target: 'uniform' as const, highlight: true }],
    });
    expect(result).toEqual([{
      left: [0, 255, 0, 255],
      right: [0, 0, 0, 255],
      originalProgramsBound: [true],
      colorUniform: [0, 0, 1, 1],
      errors: [0],
    }]);
  });

  it('keeps highlight program lifetimes independent across WebGL contexts', async () => {
    const result = await page.evaluate(replayPreboundFrames, {
      vertexSource: VERTEX_SOURCE,
      fragmentSource: FRAGMENT_SOURCE,
      steps: [
        { context: 0, target: 'a' as const, highlight: true },
        { context: 1, target: 'b' as const, highlight: true },
        { context: 0, target: 'b' as const, highlight: false },
        { context: 1, target: 'a' as const, highlight: true },
      ],
    });
    expect(result).toEqual([
      { left: [255, 0, 255, 255], right: [0, 0, 0, 255], originalProgramsBound: [true, true], colorUniform: [0, 1, 0, 1], errors: [0, 0] },
      { left: [0, 255, 0, 255], right: [255, 0, 255, 255], originalProgramsBound: [true, true], colorUniform: [0, 0, 1, 1], errors: [0, 0] },
      { left: [0, 255, 0, 255], right: [0, 0, 255, 255], originalProgramsBound: [true, true], colorUniform: [0, 0, 1, 1], errors: [0, 0] },
      { left: [255, 0, 255, 255], right: [0, 0, 0, 255], originalProgramsBound: [true, true], colorUniform: [0, 1, 0, 1], errors: [0, 0] },
    ]);
  });

  it('highlights only the selected draw call, leaving other draws at their real color', async () => {
    const result = await page.evaluate(
      ({ vertexSource, fragmentSource }) => {
        const WGDNS = (window as unknown as { WGD: typeof import('./fixtures/browserEntry.js') }).WGD;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;

        function compile(type: number, source: string): WebGLShader {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
          }
          return shader;
        }

        const vs = compile(gl.VERTEX_SHADER, vertexSource);
        const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        }

        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.1, -0.1, 0.1, -0.1, 0.0, 0.1]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        gl.bindVertexArray(null);

        const registry = WGDNS.createObjectRegistry();
        const programRef = WGDNS.registerObject(registry, program, 'WebGLProgram');
        const vaoRef = WGDNS.registerObject(registry, vao, 'WebGLVertexArrayObject');
        const offsetLoc = gl.getUniformLocation(program, 'uOffset')!;
        const colorLoc = gl.getUniformLocation(program, 'uColor')!;
        const offsetLocRef = WGDNS.registerObject(registry, offsetLoc, 'WebGLUniformLocation');
        const colorLocRef = WGDNS.registerObject(registry, colorLoc, 'WebGLUniformLocation');

        const glObj = (id: number) => ({ kind: 'globject' as const, display: '', raw: { id } });
        const raw = (kind: string, value: unknown) => ({ kind: kind as never, display: '', raw: value });

        let nextId = 0;
        const call = (name: string, args: unknown[]) => ({
          id: nextId++,
          name,
          args: args as never[],
          result: undefined,
          timestamp: 0,
        });

        // draw A: offset left, green. draw B: offset right, blue.
        const calls = [
          call('clearColor', [raw('number', 0), raw('number', 0), raw('number', 0), raw('number', 1)]),
          call('clear', [raw('enum', gl.COLOR_BUFFER_BIT)]),
          call('useProgram', [glObj(programRef.id)]),
          call('bindVertexArray', [glObj(vaoRef.id)]),
          call('uniform2fv', [glObj(offsetLocRef.id), raw('typedarray', [-0.5, 0])]),
          call('uniform4fv', [glObj(colorLocRef.id), raw('typedarray', [0, 1, 0, 1])]),
          call('drawArrays', [raw('enum', gl.TRIANGLES), raw('number', 0), raw('number', 3)]), // draw A
          call('uniform2fv', [glObj(offsetLocRef.id), raw('typedarray', [0.5, 0])]),
          call('uniform4fv', [glObj(colorLocRef.id), raw('typedarray', [0, 0, 1, 1])]),
          call('drawArrays', [raw('enum', gl.TRIANGLES), raw('number', 0), raw('number', 3)]), // draw B
        ];
        const drawAId = 6;
        const drawBId = 9;

        const leftPixel = (): [number, number, number, number] => {
          const p = new Uint8Array(4);
          gl.readPixels(16, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
          return [p[0], p[1], p[2], p[3]];
        };
        const rightPixel = (): [number, number, number, number] => {
          const p = new Uint8Array(4);
          gl.readPixels(48, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
          return [p[0], p[1], p[2], p[3]];
        };

        WGDNS.replayCalls(gl, calls, registry, drawAId, WGDNS.DRAW_CALL_DEBUG_MODE.HIGHLIGHT);
        const atA_whenA_selected = leftPixel();

        WGDNS.replayCalls(gl, calls, registry, drawBId, WGDNS.DRAW_CALL_DEBUG_MODE.HIGHLIGHT);
        const atA_whenB_selected = leftPixel();
        const atB_whenB_selected = rightPixel();

        return { atA_whenA_selected, atA_whenB_selected, atB_whenB_selected };
      },
      { vertexSource: VERTEX_SOURCE, fragmentSource: FRAGMENT_SOURCE },
    );

    // Selecting draw A: its own pixels should be highlighted magenta, not its real green.
    expect(result.atA_whenA_selected).toEqual([255, 0, 255, 255]);

    // Selecting draw B (a later call): draw A's pixels must show its real,
    // un-highlighted green — this is the exact case that was reportedly
    // broken ("only works on the last draw call").
    expect(result.atA_whenB_selected).toEqual([0, 255, 0, 255]);
    // ...and draw B itself, now the target, should be highlighted.
    expect(result.atB_whenB_selected).toEqual([255, 0, 255, 255]);
  });

  it('handles two draws using two different programs, reselected back and forth', async () => {
    const result = await page.evaluate(() => {
      const WGDNS = (window as unknown as { WGD: typeof import('./fixtures/browserEntry.js') }).WGD;
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;

      function compile(type: number, source: string): WebGLShader {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
        }
        return shader;
      }

      function makeProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
        const vs = compile(gl.VERTEX_SHADER, vertexSource);
        const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
        }
        return program;
      }

      function makeVao(x: number): WebGLVertexArrayObject {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const buf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x - 0.1, -0.1, x + 0.1, -0.1, x, 0.1]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        gl.bindVertexArray(null);
        return vao;
      }

      // Program A: uses a uOffset uniform (like the highlight test above).
      const programA = makeProgram(
        `#version 300 es
        in vec2 aPosition;
        uniform vec2 uOffset;
        void main() { gl_Position = vec4(aPosition + uOffset, 0.0, 1.0); }`,
        `#version 300 es
        precision mediump float;
        uniform vec4 uColor;
        out vec4 fragColor;
        void main() { fragColor = uColor; }`,
      );
      // Program B: deliberately shaped differently — no uOffset uniform at
      // all (geometry is pre-shifted into the buffer instead), so its set of
      // active uniforms doesn't match program A's.
      const programB = makeProgram(
        `#version 300 es
        in vec2 aPosition;
        void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`,
        `#version 300 es
        precision mediump float;
        uniform vec4 uColor;
        out vec4 fragColor;
        void main() { fragColor = uColor; }`,
      );

      const vaoA = makeVao(-0.5); // left
      const vaoB = makeVao(0.5); // right

      const registry = WGDNS.createObjectRegistry();
      const ref = (obj: object, type: string) => WGDNS.registerObject(registry, obj, type).id;
      const programARef = ref(programA, 'WebGLProgram');
      const programBRef = ref(programB, 'WebGLProgram');
      const vaoARef = ref(vaoA, 'WebGLVertexArrayObject');
      const vaoBRef = ref(vaoB, 'WebGLVertexArrayObject');
      const offsetLoc = gl.getUniformLocation(programA, 'uOffset')!;
      const offsetLocRef = ref(offsetLoc, 'WebGLUniformLocation');
      const colorLocARef = ref(gl.getUniformLocation(programA, 'uColor')!, 'WebGLUniformLocation');
      const colorLocBRef = ref(gl.getUniformLocation(programB, 'uColor')!, 'WebGLUniformLocation');

      const glObj = (id: number) => ({ kind: 'globject' as const, display: '', raw: { id } });
      const raw = (kind: string, value: unknown) => ({ kind: kind as never, display: '', raw: value });
      let nextId = 0;
      const call = (name: string, args: unknown[]) => ({
        id: nextId++,
        name,
        args: args as never[],
        result: undefined,
        timestamp: 0,
      });

      const calls = [
        call('clearColor', [raw('number', 0), raw('number', 0), raw('number', 0), raw('number', 1)]),
        call('clear', [raw('enum', gl.COLOR_BUFFER_BIT)]),
        call('useProgram', [glObj(programARef)]),
        call('bindVertexArray', [glObj(vaoARef)]),
        call('uniform2fv', [glObj(offsetLocRef), raw('typedarray', [0, 0])]),
        call('uniform4fv', [glObj(colorLocARef), raw('typedarray', [0, 1, 0, 1])]),
        call('drawArrays', [raw('enum', gl.TRIANGLES), raw('number', 0), raw('number', 3)]), // draw A (program A, green, left)
        call('useProgram', [glObj(programBRef)]),
        call('bindVertexArray', [glObj(vaoBRef)]),
        call('uniform4fv', [glObj(colorLocBRef), raw('typedarray', [0, 0, 1, 1])]),
        call('drawArrays', [raw('enum', gl.TRIANGLES), raw('number', 0), raw('number', 3)]), // draw B (program B, blue, right)
      ];
      const drawAId = 6;
      const drawBId = 10;

      const leftPixel = (): number[] => {
        const p = new Uint8Array(4);
        gl.readPixels(16, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        return Array.from(p);
      };
      const rightPixel = (): number[] => {
        const p = new Uint8Array(4);
        gl.readPixels(48, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
        return Array.from(p);
      };

      const select = (targetId: number) =>
        WGDNS.replayCalls(gl, calls, registry, targetId, WGDNS.DRAW_CALL_DEBUG_MODE.HIGHLIGHT);

      select(drawAId);
      const step1 = { left: leftPixel(), right: rightPixel() };
      select(drawBId);
      const step2 = { left: leftPixel(), right: rightPixel() };
      select(drawAId); // back to A — this is where staleness from B's override program would show up
      const step3 = { left: leftPixel(), right: rightPixel() };
      select(drawBId); // forward to B again
      const step4 = { left: leftPixel(), right: rightPixel() };

      return { step1, step2, step3, step4 };
    });

    const MAGENTA = [255, 0, 255, 255];
    const GREEN = [0, 255, 0, 255];
    const BLUE = [0, 0, 255, 255];
    const BLACK = [0, 0, 0, 255];

    expect(result.step1).toEqual({ left: MAGENTA, right: BLACK }); // A selected: A highlighted, B not yet drawn
    expect(result.step2).toEqual({ left: GREEN, right: MAGENTA }); // B selected: A real color, B highlighted
    expect(result.step3).toEqual({ left: MAGENTA, right: BLACK }); // back to A: same as step1, no staleness from B
    expect(result.step4).toEqual({ left: GREEN, right: MAGENTA }); // forward to B again: same as step2
  });
});
