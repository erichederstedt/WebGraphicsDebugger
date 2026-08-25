import { describe, expect, it } from 'vitest';
import { createStateTracker, pushCall, resetStateTracker, stateAt } from '../../src/state/stateTracker.js';
import { makeHandle } from '../fixtures/fakeContext.js';
import { call, recordCalls } from './helpers.js';

describe('StateTracker', () => {
  it('stateAt(-1) and stateAt before any pushCall both return the initial state', () => {
    const tracker = createStateTracker();
    expect(stateAt(tracker, -1)).toEqual(stateAt(tracker, -1));
    expect(stateAt(tracker, -1).bufferBindings.ARRAY_BUFFER).toBeNull();
  });

  it('rewinds to the exact state after each call as the selection index changes', () => {
    const bufferA = makeHandle('WebGLBuffer');
    const bufferB = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, bufferA); // index 0
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3); // index 1, unrelated
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, bufferB); // index 2
    });

    const tracker = createStateTracker();
    resetStateTracker(tracker, calls);

    expect(stateAt(tracker, 0).bufferBindings.ARRAY_BUFFER).toMatchObject({ type: 'WebGLBuffer' });
    const boundAtIndex0 = stateAt(tracker, 0).bufferBindings.ARRAY_BUFFER;

    // index 1 (an unrelated draw call) must not change the binding captured at index 0
    expect(stateAt(tracker, 1).bufferBindings.ARRAY_BUFFER).toEqual(boundAtIndex0);

    // index 2 rebinds to a different buffer
    expect(stateAt(tracker, 2).bufferBindings.ARRAY_BUFFER).not.toEqual(boundAtIndex0);
  });

  it('pushCall() incrementally matches what resetStateTracker() computes from the full list', () => {
    const buffer = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buffer);
      call(gl, 'viewport', 0, 0, 640, 480);
    });

    const incremental = createStateTracker();
    for (const c of calls) pushCall(incremental, c);

    const bulk = createStateTracker();
    resetStateTracker(bulk, calls);

    expect(stateAt(incremental, 1)).toEqual(stateAt(bulk, 1));
  });

  it('clamps out-of-range indices to the last recorded snapshot', () => {
    const { calls } = recordCalls((gl) => call(gl, 'viewport', 0, 0, 100, 100));
    const tracker = createStateTracker();
    resetStateTracker(tracker, calls);
    expect(stateAt(tracker, 999)).toEqual(stateAt(tracker, 0));
  });

  it('accepts an initial state override for accurate seeding (e.g. real canvas viewport)', () => {
    const tracker = createStateTracker({ viewport: { x: 0, y: 0, width: 300, height: 150 } });
    expect(stateAt(tracker, -1).viewport).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });
});
