import { describe, expect, it } from 'vitest';
import { findRedundantCalls } from '../src/redundancy.js';
import { StateTracker } from '../src/state/stateTracker.js';
import type { GLCall } from '../src/types.js';
import { makeHandle } from './fixtures/fakeContext.js';
import { call, recordCalls } from './state/helpers.js';

function trackerFor(calls: readonly GLCall[]): StateTracker {
  const tracker = new StateTracker();
  tracker.reset(calls);
  return tracker;
}

function redundantCallsIn(calls: GLCall[]): Map<number, number | null> {
  return findRedundantCalls(calls, trackerFor(calls));
}

describe('findRedundantCalls — clears', () => {
  it('flags an earlier clear fully overwritten by a later one with no draw in between', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'clear', gl.COLOR_BUFFER_BIT);
      call(gl, 'clear', gl.COLOR_BUFFER_BIT);
    });
    const redundant = redundantCallsIn(calls);
    expect(redundant.get(calls[0].id)).toBe(calls[1].id); // points at the clear that superseded it
    expect(redundant.has(calls[1].id)).toBe(false);
  });

  it('does not flag a clear that was drawn on top of before the next clear', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'clear', gl.COLOR_BUFFER_BIT);
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3);
      call(gl, 'clear', gl.COLOR_BUFFER_BIT);
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });

  it('does not confuse a clear on one framebuffer with a clear on another', () => {
    const fb = makeHandle('WebGLFramebuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'clear', gl.COLOR_BUFFER_BIT); // default framebuffer
      call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, fb);
      call(gl, 'clear', gl.COLOR_BUFFER_BIT); // different (offscreen) framebuffer
    });
    // The default-framebuffer clear must not be flagged as redundant against the offscreen one's clear.
    // (The offscreen clear itself is separately flagged by the unused-render-target check, tested below.)
    expect(redundantCallsIn(calls).has(calls[0].id)).toBe(false);
  });

  it('only flags when the later clear covers every bit the earlier one covered', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'clear', (gl.COLOR_BUFFER_BIT as number) | (gl.DEPTH_BUFFER_BIT as number));
      call(gl, 'clear', gl.COLOR_BUFFER_BIT); // doesn't also cover DEPTH — first clear still mattered
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });
});

describe('findRedundantCalls — unused render targets', () => {
  it('flags draws (and clears) into an offscreen FBO whose attached texture is never used afterward', () => {
    const fb = makeHandle('WebGLFramebuffer');
    const tex = makeHandle('WebGLTexture');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, fb);
      call(gl, 'framebufferTexture2D', gl.FRAMEBUFFER, 0, gl.TEXTURE_2D, tex, 0);
      call(gl, 'clear', gl.COLOR_BUFFER_BIT);
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3);
      call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, null); // back to default, texture never touched again
    });
    const redundant = redundantCallsIn(calls);
    const clearCall = calls.find((c) => c.name === 'clear')!;
    const drawCall = calls.find((c) => c.name === 'drawArrays')!;
    expect(redundant.has(clearCall.id)).toBe(true);
    expect(redundant.has(drawCall.id)).toBe(true);
  });

  it('does not flag an offscreen render target whose texture is bound and drawn with afterward', () => {
    const fb = makeHandle('WebGLFramebuffer');
    const tex = makeHandle('WebGLTexture');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, fb);
      call(gl, 'framebufferTexture2D', gl.FRAMEBUFFER, 0, gl.TEXTURE_2D, tex, 0);
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3); // renders into the offscreen target
      call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, null);
      call(gl, 'bindTexture', gl.TEXTURE_2D, tex); // sampled back
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3); // ... in this draw to the default framebuffer
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });

  it('does not flag an offscreen render target that gets read back via readPixels', () => {
    const fb = makeHandle('WebGLFramebuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindFramebuffer', gl.FRAMEBUFFER, fb);
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3);
      call(gl, 'readPixels', 0, 0, 1, 1, 0, 0, new Uint8Array(4));
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });

  it('never flags draws to the default framebuffer', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'clear', gl.COLOR_BUFFER_BIT);
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3);
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });
});

describe('findRedundantCalls — no-op state changes', () => {
  it('flags rebinding the same buffer to the same target', () => {
    const buf = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buf);
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buf);
    });
    const redundant = redundantCallsIn(calls);
    expect(redundant.has(calls[0].id)).toBe(false); // first bind actually changed the binding
    expect(redundant.get(calls[1].id)).toBe(calls[0].id); // points at the call that already set it
  });

  it('does not flag binding a different buffer to the same target', () => {
    const a = makeHandle('WebGLBuffer');
    const b = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, a);
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, b);
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });

  it('flags enabling a capability that is already enabled', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'enable', gl.DEPTH_TEST);
      call(gl, 'enable', gl.DEPTH_TEST);
    });
    const redundant = redundantCallsIn(calls);
    expect(redundant.has(calls[0].id)).toBe(false);
    expect(redundant.has(calls[1].id)).toBe(true);
  });

  it('flags setting the viewport to its current value', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'viewport', 0, 0, 800, 600);
      call(gl, 'viewport', 0, 0, 800, 600);
    });
    const redundant = redundantCallsIn(calls);
    expect(redundant.has(calls[0].id)).toBe(false);
    expect(redundant.has(calls[1].id)).toBe(true);
  });

  it('does not flag a viewport call that actually changes the size', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'viewport', 0, 0, 800, 600);
      call(gl, 'viewport', 0, 0, 400, 300);
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });
});

describe('findRedundantCalls — no-op uniform sets', () => {
  it('flags setting a uniform location to the value it already holds', () => {
    const loc = makeHandle('WebGLUniformLocation');
    const { calls } = recordCalls((gl) => {
      call(gl, 'uniform1f', loc, 5);
      call(gl, 'uniform1f', loc, 5);
    });
    const redundant = redundantCallsIn(calls);
    expect(redundant.has(calls[0].id)).toBe(false);
    expect(redundant.get(calls[1].id)).toBe(calls[0].id);
  });

  it('does not flag setting a uniform location to a new value', () => {
    const loc = makeHandle('WebGLUniformLocation');
    const { calls } = recordCalls((gl) => {
      call(gl, 'uniform1f', loc, 5);
      call(gl, 'uniform1f', loc, 6);
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });
});

describe('findRedundantCalls — degenerate draws', () => {
  it('flags drawArrays with a zero count, with no specific cause to point to', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 0);
    });
    expect(redundantCallsIn(calls).get(calls[0].id)).toBeNull();
  });

  it('flags clear(0)', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'clear', 0);
    });
    expect(redundantCallsIn(calls).has(calls[0].id)).toBe(true);
  });

  it('does not flag a normal drawArrays with a positive count', () => {
    const { calls } = recordCalls((gl) => {
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3);
    });
    expect(redundantCallsIn(calls).size).toBe(0);
  });
});
