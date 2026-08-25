import { describe, expect, it, vi } from 'vitest';
import { attachRecorder } from '../src/recorder.js';
import { createFakeContext, makeHandle } from './fixtures/fakeContext.js';
import { ALL_WEBGL_METHODS } from './fixtures/methodNames.js';

describe('attachRecorder — full WebGL1+WebGL2 method coverage', () => {
  it.each(ALL_WEBGL_METHODS)('wraps %s: records exactly one call and returns the real result', (methodName) => {
    const sentinelResult = { marker: `${methodName}-result` };
    const gl = createFakeContext({ [methodName]: () => sentinelResult });
    const { calls } = attachRecorder(gl);

    const args = [1, 'x', true];
    const returned = (gl[methodName] as (...a: unknown[]) => unknown)(...args);

    expect(returned).toBe(sentinelResult);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe(methodName);
    expect(calls[0].args).toHaveLength(3);
    expect(calls[0].threwError).toBeUndefined();
  });

  it.each(ALL_WEBGL_METHODS)('wraps %s: underlying implementation still runs with gl as `this`', (methodName) => {
    let sawThis: unknown;
    let sawArgs: unknown[] | undefined;
    const gl = createFakeContext({
      [methodName]: function (this: unknown, ...args: unknown[]) {
        sawThis = this;
        sawArgs = args;
        return undefined;
      },
    });
    attachRecorder(gl);

    (gl[methodName] as (...a: unknown[]) => unknown)(7, 8);

    expect(sawThis).toBe(gl);
    expect(sawArgs).toEqual([7, 8]);
  });

  it.each(ALL_WEBGL_METHODS)('wraps %s: a thrown error propagates to the caller and is captured on the call', (methodName) => {
    const gl = createFakeContext({
      [methodName]: () => {
        throw new Error(`boom-${methodName}`);
      },
    });
    const { calls } = attachRecorder(gl);

    expect(() => (gl[methodName] as (...a: unknown[]) => unknown)()).toThrow(`boom-${methodName}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].threwError).toBe(`boom-${methodName}`);
  });
});

describe('attachRecorder — object registry integration', () => {
  it('assigns a fresh object id for every create* method', () => {
    const handle = makeHandle('WebGLBuffer');
    const gl = createFakeContext({ createBuffer: () => handle });
    const { calls } = attachRecorder(gl);

    (gl.createBuffer as () => unknown)();

    expect(calls[0].objectId).toBe(1);
    expect(calls[0].result).toEqual({ kind: 'globject', display: 'WebGLBuffer#1', raw: { id: 1, type: 'WebGLBuffer', origin: 'created' } });
  });

  it('assigns an id for getUniformLocation and fenceSync results too', () => {
    const program = makeHandle('WebGLProgram');
    const loc = makeHandle('WebGLUniformLocation');
    const sync = makeHandle('WebGLSync');
    const gl = createFakeContext({
      createProgram: () => program,
      getUniformLocation: () => loc,
      fenceSync: () => sync,
    });
    const { calls } = attachRecorder(gl);

    (gl.createProgram as () => unknown)();
    (gl.getUniformLocation as (...a: unknown[]) => unknown)(program, 'u_color');
    (gl.fenceSync as (...a: unknown[]) => unknown)(0x9117, 0);

    expect(calls[0].objectId).toBe(1); // program, from createProgram
    expect(calls[1].objectId).toBe(2); // loc, from getUniformLocation — the `program` arg resolves to its existing id, not a new one
    expect(calls[2].objectId).toBe(3); // sync, from fenceSync
  });

  it('does NOT assign an id for getExtension or getActiveAttrib results', () => {
    const ext = { name: 'OES_texture_float' };
    const activeAttrib = { name: 'a_position', size: 1, type: 0x1406 };
    const gl = createFakeContext({
      getExtension: () => ext,
      getActiveAttrib: () => activeAttrib,
    });
    const { calls } = attachRecorder(gl);

    (gl.getExtension as (...a: unknown[]) => unknown)('OES_texture_float');
    (gl.getActiveAttrib as (...a: unknown[]) => unknown)(makeHandle('WebGLProgram'), 0);

    expect(calls[0].objectId).toBeUndefined();
    expect(calls[1].objectId).toBeUndefined();
    expect(calls[0].result?.kind).toBe('other');
    expect(calls[1].result?.kind).toBe('other');
  });

  it('the same handle object always resolves to the same id when passed as an arg later', () => {
    const texture = makeHandle('WebGLTexture');
    const gl = createFakeContext({ createTexture: () => texture });
    const { calls } = attachRecorder(gl);

    (gl.createTexture as () => unknown)();
    (gl.bindTexture as (...a: unknown[]) => unknown)(gl.TEXTURE_2D, texture);

    const createdId = calls[0].objectId;
    const boundArg = calls[1].args[1];
    expect(boundArg.kind).toBe('globject');
    expect((boundArg.raw as { id: number }).id).toBe(createdId);
  });
});

describe('attachRecorder — argument serialization', () => {
  it('clones typed array arguments so later mutation cannot corrupt history', () => {
    const gl = createFakeContext();
    const { calls } = attachRecorder(gl);
    const data = new Float32Array([1, 2, 3]);

    (gl.bufferData as (...a: unknown[]) => unknown)(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    data[0] = 999;

    const recordedArray = calls[0].args[1].raw as Float32Array;
    expect(recordedArray).not.toBe(data);
    expect(Array.from(recordedArray)).toEqual([1, 2, 3]);
  });

  it('decodes GLenum-valued numeric arguments to their constant name', () => {
    const gl = createFakeContext();
    const { calls } = attachRecorder(gl);

    (gl.bindTexture as (...a: unknown[]) => unknown)(gl.TEXTURE_2D, null);

    expect(calls[0].args[0]).toMatchObject({ kind: 'enum', display: 'TEXTURE_2D', raw: gl.TEXTURE_2D });
    expect(calls[0].args[1]).toMatchObject({ kind: 'null', display: 'null', raw: null });
  });

  it('detach() restores every original method', () => {
    const original = vi.fn();
    const gl = createFakeContext({ drawArrays: original });
    const rawOriginal = gl.drawArrays;
    const { detach } = attachRecorder(gl);

    expect(gl.drawArrays).not.toBe(rawOriginal);
    detach();
    expect(gl.drawArrays).toBe(rawOriginal);
  });
});
