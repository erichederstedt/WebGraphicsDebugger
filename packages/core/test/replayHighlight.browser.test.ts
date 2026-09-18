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

describe('replayCalls highlight overlay, against a real WebGL2 context', () => {
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
