import { describe, expect, it } from 'vitest';
import { StateTracker } from '../../src/state/stateTracker.js';
import { makeHandle } from '../fixtures/fakeContext.js';
import { call, recordCalls } from './helpers.js';

describe('StateTracker', () => {
  it('getStateAt(-1) and getStateAt before any push both return the initial state', () => {
    const tracker = new StateTracker();
    expect(tracker.getStateAt(-1)).toEqual(tracker.getStateAt(-1));
    expect(tracker.getStateAt(-1).bufferBindings.ARRAY_BUFFER).toBeNull();
  });

  it('rewinds to the exact state after each call as the selection index changes', () => {
    const bufferA = makeHandle('WebGLBuffer');
    const bufferB = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, bufferA); // index 0
      call(gl, 'drawArrays', gl.TRIANGLES, 0, 3); // index 1, unrelated
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, bufferB); // index 2
    });

    const tracker = new StateTracker();
    tracker.reset(calls);

    expect(tracker.getStateAt(0).bufferBindings.ARRAY_BUFFER).toMatchObject({ type: 'WebGLBuffer' });
    const boundAtIndex0 = tracker.getStateAt(0).bufferBindings.ARRAY_BUFFER;

    // index 1 (an unrelated draw call) must not change the binding captured at index 0
    expect(tracker.getStateAt(1).bufferBindings.ARRAY_BUFFER).toEqual(boundAtIndex0);

    // index 2 rebinds to a different buffer
    expect(tracker.getStateAt(2).bufferBindings.ARRAY_BUFFER).not.toEqual(boundAtIndex0);
  });

  it('push() incrementally matches what reset() computes from the full list', () => {
    const buffer = makeHandle('WebGLBuffer');
    const { calls } = recordCalls((gl) => {
      call(gl, 'bindBuffer', gl.ARRAY_BUFFER, buffer);
      call(gl, 'viewport', 0, 0, 640, 480);
    });

    const incremental = new StateTracker();
    for (const c of calls) incremental.push(c);

    const bulk = new StateTracker();
    bulk.reset(calls);

    expect(incremental.getStateAt(1)).toEqual(bulk.getStateAt(1));
  });

  it('clamps out-of-range indices to the last recorded snapshot', () => {
    const { calls } = recordCalls((gl) => call(gl, 'viewport', 0, 0, 100, 100));
    const tracker = new StateTracker();
    tracker.reset(calls);
    expect(tracker.getStateAt(999)).toEqual(tracker.getStateAt(0));
  });

  it('accepts an initial state override for accurate seeding (e.g. real canvas viewport)', () => {
    const tracker = new StateTracker({ viewport: { x: 0, y: 0, width: 300, height: 150 } });
    expect(tracker.getStateAt(-1).viewport).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });
});
