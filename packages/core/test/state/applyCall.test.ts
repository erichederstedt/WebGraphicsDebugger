import { describe, expect, it } from 'vitest';
import { applyCall } from '../../src/state/applyCall.js';
import { createInitialState } from '../../src/state/stateModel.js';
import { makeHandle } from '../fixtures/fakeContext.js';
import { call, recordCalls } from './helpers.js';

function reduceAll(calls: ReturnType<typeof recordCalls>['calls']) {
  return calls.reduce(applyCall, createInitialState());
}

describe('applyCall — buffer bindings', () => {
  it('bindBuffer sets the binding for the given target only', () => {
    const buffer = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buffer));
    const state = reduceAll(calls);
    expect(state.bufferBindings.ARRAY_BUFFER).toMatchObject({ type: 'WebGLBuffer' });
    expect(state.bufferBindings.ELEMENT_ARRAY_BUFFER).toBeNull();
  });

  it('bindBuffer(target, null) unbinds', () => {
    const buffer = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buffer);
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, null);
    });
    const state = reduceAll(calls);
    expect(state.bufferBindings.ARRAY_BUFFER).toBeNull();
  });
});

describe('applyCall — texture bindings', () => {
  it('activeTexture selects the unit that subsequent bindTexture calls affect', () => {
    const tex0 = makeHandle('WebGLTexture');
    const tex1 = makeHandle('WebGLTexture');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindTexture', gl.TEXTURE_2D, tex0); // unit 0, implicit default active unit
      call(gl, 'activeTexture', gl.TEXTURE1);
      call(gl, 'bindTexture', gl.TEXTURE_2D, tex1); // unit 1
    });
    const state = reduceAll(calls);
    expect(state.activeTextureUnit).toBe(1);
    expect(state.textureUnits[0].TEXTURE_2D).toMatchObject({ id: expect.any(Number) });
    expect(state.textureUnits[1].TEXTURE_2D).toMatchObject({ id: expect.any(Number) });
    expect(state.textureUnits[0].TEXTURE_2D).not.toEqual(state.textureUnits[1].TEXTURE_2D);
  });

  it('binding a different target on the same unit does not clobber the other target', () => {
    const tex2d = makeHandle('WebGLTexture');
    const texCube = makeHandle('WebGLTexture');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindTexture', gl.TEXTURE_2D, tex2d);
      call(gl, 'bindTexture', gl.TEXTURE_CUBE_MAP, texCube);
    });
    const state = reduceAll(calls);
    expect(state.textureUnits[0].TEXTURE_2D).not.toBeNull();
    expect(state.textureUnits[0].TEXTURE_CUBE_MAP).not.toBeNull();
  });
});

describe('applyCall — program, framebuffer, renderbuffer, vertex array', () => {
  it('useProgram sets currentProgram', () => {
    const program = makeHandle('WebGLProgram');
    const { calls } = recordCalls((gl) => call(gl, 'useProgram', program));
    expect(reduceAll(calls).currentProgram).toMatchObject({ type: 'WebGLProgram' });
  });

  it('bindFramebuffer(FRAMEBUFFER, fb) sets draw AND read bindings', () => {
    const fb = makeHandle('WebGLFramebuffer');
    const { calls } = recordCalls((gl) => call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, fb));
    const state = reduceAll(calls);
    expect(state.framebufferBindings.FRAMEBUFFER).toMatchObject({ type: 'WebGLFramebuffer' });
    expect(state.framebufferBindings.DRAW_FRAMEBUFFER).toEqual(state.framebufferBindings.FRAMEBUFFER);
    expect(state.framebufferBindings.READ_FRAMEBUFFER).toEqual(state.framebufferBindings.FRAMEBUFFER);
  });

  it('bindFramebuffer(DRAW_FRAMEBUFFER, fb) only affects the draw binding', () => {
    const fb = makeHandle('WebGLFramebuffer');
    const { calls } = recordCalls((gl) => call(gl, 'bindFramebuffer', gl.DRAW_FRAMEBUFFER, fb));
    const state = reduceAll(calls);
    expect(state.framebufferBindings.DRAW_FRAMEBUFFER).not.toBeNull();
    expect(state.framebufferBindings.READ_FRAMEBUFFER).toBeNull();
  });

  it('bindRenderbuffer sets renderbufferBinding', () => {
    const rb = makeHandle('WebGLRenderbuffer');
    const { calls } = recordCalls((gl) => call(gl, 'bindRenderbuffer', gl.RENDERBUFFER, rb));
    expect(reduceAll(calls).renderbufferBinding).toMatchObject({ type: 'WebGLRenderbuffer' });
  });

  it('bindVertexArray sets vertexArrayBinding', () => {
    const vao = makeHandle('WebGLVertexArrayObject');
    const { calls } = recordCalls((gl) => call(gl, 'bindVertexArray', vao));
    expect(reduceAll(calls).vertexArrayBinding).toMatchObject({ type: 'WebGLVertexArrayObject' });
  });
});

describe('applyCall — vertex attribs', () => {
  it('vertexAttribPointer captures the currently-bound ARRAY_BUFFER and pointer params', () => {
    const buffer = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buffer);
      call(gl, 'vertexAttribPointer', 0, 3, gl.FLOAT, false, 12, 0);
    });
    const state = reduceAll(calls);
    const attrib = state.vertexAttribs[0];
    expect(attrib.buffer).toMatchObject({ type: 'WebGLBuffer' });
    expect(attrib.size).toBe(3);
    expect(attrib.type).toEqual({ raw: expect.any(Number), name: 'FLOAT' });
    expect(attrib.stride).toBe(12);
  });

  it('enableVertexAttribArray/disableVertexAttribArray toggle only the targeted index', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'enableVertexAttribArray', 0);
      call(gl, 'enableVertexAttribArray', 2);
      call(gl, 'disableVertexAttribArray', 0);
    });
    const state = reduceAll(calls);
    expect(state.vertexAttribs[0].enabled).toBe(false);
    expect(state.vertexAttribs[1].enabled).toBe(false);
    expect(state.vertexAttribs[2].enabled).toBe(true);
  });
});

describe('applyCall — viewport, scissor, clear values', () => {
  it('viewport and scissor are tracked independently', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'viewport', 0, 0, 800, 600);
      call(gl, 'scissor', 10, 20, 100, 200);
    });
    const state = reduceAll(calls);
    expect(state.viewport).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(state.scissorBox).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  it('clearColor/clearDepth/clearStencil update independently', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'clearColor', 1, 0.5, 0.25, 1);
      call(gl, 'clearDepth', 0.5);
      call(gl, 'clearStencil', 7);
    });
    const state = reduceAll(calls);
    expect(state.clearColor).toEqual([1, 0.5, 0.25, 1]);
    expect(state.clearDepth).toBe(0.5);
    expect(state.clearStencil).toBe(7);
  });
});

describe('applyCall — capabilities and pipeline state', () => {
  it('enable/disable toggle only the targeted capability', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'enable', gl.DEPTH_TEST);
      call(gl, 'enable', gl.BLEND);
      call(gl, 'disable', gl.BLEND);
    });
    const state = reduceAll(calls);
    expect(state.capabilities.DEPTH_TEST).toBe(true);
    expect(state.capabilities.BLEND).toBe(false);
    expect(state.capabilities.CULL_FACE).toBe(false);
  });

  it('blendFunc sets both RGB and alpha factors; blendFuncSeparate sets them independently', () => {
    const { calls: c1 } = recordCalls((gl) => call(gl, 'blendFunc', gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA));
    const s1 = reduceAll(c1);
    expect(s1.blend.srcRGB.name).toBe('SRC_ALPHA');
    expect(s1.blend.srcAlpha.name).toBe('SRC_ALPHA');

    const { calls: c2 } = recordCalls((gl) => call(gl, 'blendFuncSeparate', gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO));
    const s2 = reduceAll(c2);
    expect(s2.blend.srcRGB.name).toBe('SRC_ALPHA');
    expect(s2.blend.srcAlpha.name).toBe('ONE');
  });

  it('depthFunc/depthMask/cullFace/frontFace update their respective fields', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'depthFunc', gl.LEQUAL);
      call(gl, 'depthMask', false);
      call(gl, 'cullFace', gl.FRONT);
      call(gl, 'frontFace', gl.CW);
    });
    const state = reduceAll(calls);
    expect(state.depth.func.name).toBe('LEQUAL');
    expect(state.depth.mask).toBe(false);
    expect(state.cull.mode.name).toBe('FRONT');
    expect(state.cull.frontFace.name).toBe('CW');
  });

  it('pixelStorei records the param by name', () => {
    const { calls } = recordCalls((gl) => call(gl, 'pixelStorei', gl.UNPACK_FLIP_Y_WEBGL, true));
    expect(reduceAll(calls).pixelStore.UNPACK_FLIP_Y_WEBGL).toBe(true);
  });
});

describe('applyCall — calls unrelated to tracked state', () => {
  it('leaves state unchanged (same reference) for calls like drawArrays', () => {
    const { calls } = recordCalls((gl) => call(gl, 'drawArrays', gl.TRIANGLES, 0, 3));
    const initial = createInitialState();
    const next = applyCall(initial, calls[0]);
    expect(next).toBe(initial);
  });

  it('skips state mutation entirely when the call threw', () => {
    const { calls } = recordCalls(
      (gl) => {
        try {
          call(gl, 'bindBuffer', gl.ARRAY_BUFFER, {});
        } catch {
          // expected
        }
      },
      {
        bindBuffer: () => {
          throw new Error('nope');
        },
      },
    );
    const initial = createInitialState();
    const next = applyCall(initial, calls[0]);
    expect(next).toBe(initial);
  });
});
