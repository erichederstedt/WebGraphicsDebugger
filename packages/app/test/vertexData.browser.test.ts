import { afterAll, beforeAll, expect, it } from 'vitest';
import { firefox, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let display: ChildProcess;
let browser: Browser;
let page: Page;
beforeAll(async () => {
  display = spawn('Xvfb', [':98', '-screen', '0', '64x64x24'], { stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  browser = await firefox.launch({ headless: false, env: { ...process.env, DISPLAY: ':98', LIBGL_ALWAYS_SOFTWARE: '1' } });
  page = await browser.newPage();
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/vertexData.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'VertexData',
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}, 30_000);
afterAll(async () => {
  await browser?.close();
  display?.kill();
});

it('captures draw order, interleaved normalized data, integer and constant inputs, and instance divisors', async () => {
  const result = await page.evaluate(() => {
    const { captureVertexAttributes } = (window as unknown as { VertexData: typeof import('../src/vertexData.js') }).VertexData;
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const program = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, `#version 300 es
        layout(location=0) in vec3 aPosition;
        layout(location=1) in vec4 aColor;
        layout(location=2) in uvec2 aIds;
        layout(location=3) in vec2 aOffset;
        layout(location=4) in vec4 aConstant;
        void main() { gl_Position = vec4(aPosition.xy + aColor.xy + vec2(aIds) + aOffset + aConstant.xy, aPosition.z, 1); }`],
      [gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; out vec4 color; void main() { color=vec4(1); }'],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)!);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bytes = new ArrayBuffer(60);
    const view = new DataView(bytes);
    for (let vertex = 0; vertex < 3; vertex++) {
      for (let component = 0; component < 3; component++) view.setFloat32(vertex * 20 + 4 + component * 4, vertex * 3 + component + 1, true);
      new Uint8Array(bytes, vertex * 20 + 16, 4).set([255, vertex, 128, 255]);
    }
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 4);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 20, 16);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array([0xffffffff, 1, 2, 3, 4, 5]), gl.STATIC_DRAW);
    gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, 0, 0);
    gl.enableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([10, 20, 30, 40]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 2);
    gl.enableVertexAttribArray(3);
    gl.vertexAttrib4f(4, 0.25, 0.5, 0.75, 1);
    const indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([99, 2, 0, 2, 65535, 1]), gl.STATIC_DRAW);
    const oldReadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.COPY_READ_BUFFER, oldReadBuffer);
    const oldArrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    const call = (name: string) => ({ id: 0, name, args: [], result: undefined, timestamp: 0 });
    const capture = (name: string, args: number[]) => Object.fromEntries(captureVertexAttributes(gl, call(name), args).vertexAttributes);
    const arrays = capture('drawArrays', [gl.TRIANGLES, 1, 2]);
    const indexed = capture('drawElementsInstanced', [gl.TRIANGLES, 5, gl.UNSIGNED_SHORT, 2, 3]);
    const ranged = capture('drawRangeElements', [gl.TRIANGLES, 0, 2, 5, gl.UNSIGNED_SHORT, 2]);
    const empty = capture('bindBuffer', [gl.ARRAY_BUFFER]);
    const metadata = (name: string, args: number[]) => {
      const data = captureVertexAttributes(gl, call(name), args);
      return { vertexCount: data.vertexCount, indexCount: data.indexCount,
        indexBuffer: data.indexBuffer ? Array.from(data.indexBuffer) : null,
        indexType: data.indexBuffer?.constructor.name ?? null };
    };
    const indexedMetadata = metadata('drawElementsInstanced', [gl.TRIANGLES, 5, gl.UNSIGNED_SHORT, 2, 3]);
    const arraysMetadata = metadata('drawArrays', [gl.TRIANGLES, 1, 2]);
    const emptyMetadata = metadata('bindBuffer', [gl.ARRAY_BUFFER]);
    const zeroMetadata = metadata('drawElements', [gl.TRIANGLES, 0, gl.UNSIGNED_SHORT, 2]);
    const formats = [];
    for (const [type, data] of [
      [gl.UNSIGNED_BYTE, new Uint8Array([99, 2, 0, 255, 1])],
      [gl.UNSIGNED_INT, new Uint32Array([99, 2, 0, 0xffffffff, 1])],
    ] as const) {
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
      formats.push(metadata('drawElements', [gl.TRIANGLES, 4, type, data.BYTES_PER_ELEMENT]));
    }
    let failed = false;
    try { capture('drawArrays', [gl.TRIANGLES, 100, 3]); } catch { failed = true; }
    return {
      arrays, indexed, ranged, empty, failed, indexedMetadata, arraysMetadata, emptyMetadata, zeroMetadata, formats,
      restored: gl.getParameter(gl.COPY_READ_BUFFER_BINDING) === oldReadBuffer
        && gl.getParameter(gl.ARRAY_BUFFER_BINDING) === oldArrayBuffer
        && gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING) === indices
        && gl.getParameter(gl.VERTEX_ARRAY_BINDING) === vao
        && gl.getParameter(gl.CURRENT_PROGRAM) === program,
      error: gl.getError(),
    };
  });
  expect(result.arrays.aPosition).toEqual([4, 5, 6, 7, 8, 9]);
  expect(result.arrays.aOffset).toEqual([10, 20, 10, 20]);
  const positions = [7, 8, 9, 1, 2, 3, 7, 8, 9, 4, 5, 6];
  expect(result.indexed.aPosition).toEqual([...positions, ...positions, ...positions]);
  expect(result.indexed.aOffset).toEqual([...Array(8).fill([10, 20]).flat(), ...Array(4).fill([30, 40]).flat()]);
  expect(result.indexed.aIds.slice(0, 8)).toEqual([4, 5, 0xffffffff, 1, 4, 5, 2, 3]);
  expect(result.indexed.aConstant).toEqual(Array(12).fill([0.25, 0.5, 0.75, 1]).flat());
  expect(result.indexed.aColor.slice(0, 8)).toEqual([1, Math.fround(2 / 255), Math.fround(128 / 255), 1, 1, 0, Math.fround(128 / 255), 1]);
  expect(result.ranged.aPosition).toEqual(positions);
  expect(result.empty).toEqual({});
  expect(result.indexedMetadata).toEqual({ vertexCount: 12, indexCount: 5, indexBuffer: [2, 0, 2, 65535, 1], indexType: 'Uint16Array' });
  expect(result.arraysMetadata).toEqual({ vertexCount: 2, indexCount: 0, indexBuffer: null, indexType: null });
  expect(result.emptyMetadata).toEqual({ vertexCount: 0, indexCount: 0, indexBuffer: null, indexType: null });
  expect(result.zeroMetadata).toEqual(result.emptyMetadata);
  expect(result.formats).toEqual([
    { vertexCount: 3, indexCount: 4, indexBuffer: [2, 0, 255, 1], indexType: 'Uint8Array' },
    { vertexCount: 3, indexCount: 4, indexBuffer: [2, 0, 0xffffffff, 1], indexType: 'Uint32Array' },
  ]);
  expect(result.failed).toBe(true);
  expect(result.restored).toBe(true);
  expect(result.error).toBe(0);
});

it('decodes matrix columns, half floats, packed formats, and missing components', async () => {
  const result = await page.evaluate(() => {
    const { captureVertexAttributes } = (window as unknown as { VertexData: typeof import('../src/vertexData.js') }).VertexData;
    const gl = document.createElement('canvas').getContext('webgl2')!;
    const program = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, `#version 300 es
        layout(location=0) in mat2 aTransform;
        layout(location=2) in vec4 aPacked;
        layout(location=3) in vec4 aExtended;
        void main() { gl_Position=vec4(aTransform*aPacked.xy+aExtended.xy,0,1); }`],
      [gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; out vec4 color; void main() { color=vec4(1); }'],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array([0x3c00, 0x4000, 0x4200, 0xc400]), gl.STATIC_DRAW);
    for (let column = 0; column < 2; column++) {
      gl.vertexAttribPointer(column, 2, gl.HALF_FLOAT, false, 8, column * 4);
      gl.enableVertexAttribArray(column);
    }
    const packed = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, packed);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array([1023 | (512 << 20) | (3 << 30)]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_INT_2_10_10_10_REV, true, 0, 0);
    gl.enableVertexAttribArray(2);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Int16Array([-32768, 32767]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(3, 2, gl.SHORT, true, 0, 0);
    gl.enableVertexAttribArray(3);
    const call = { id: 0, name: 'drawArrays', args: [], result: undefined, timestamp: 0 };
    const unsigned = Object.fromEntries(captureVertexAttributes(gl, call, [gl.POINTS, 0, 1]).vertexAttributes);
    gl.bindBuffer(gl.ARRAY_BUFFER, packed);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array([512 | (511 << 10) | (2 << 30)]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(2, 4, gl.INT_2_10_10_10_REV, true, 0, 0);
    const signed = captureVertexAttributes(gl, call, [gl.POINTS, 0, 1]).vertexAttributes.get('aPacked');
    return { unsigned, signed, error: gl.getError() };
  });
  expect(result.unsigned).toEqual({
    aTransform: [1, 2, 3, -4],
    aPacked: [1, 0, Math.fround(512 / 1023), 1],
    aExtended: [-1, 1, 0, 1],
  });
  expect(result.signed).toEqual([-1, 1, 0, -1]);
  expect(result.error).toBe(0);
});
