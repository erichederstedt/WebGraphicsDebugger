import type { GLCall } from '../types.js';
import { applyCall } from './applyCall.js';
import { createInitialState, type GLState } from './stateModel.js';

/**
 * Holds one GLState snapshot per recorded call so the UI can "rewind" to any
 * point in the recording in O(1). Snapshots share structure (only the
 * branches touched by applyCall are cloned), so this stays cheap even for
 * long recordings.
 */
export interface StateTracker {
  snapshots: GLState[];
  initial: GLState;
}

export function createStateTracker(initialState: Partial<GLState> = {}): StateTracker {
  return { snapshots: [], initial: createInitialState(initialState) };
}

/** Feed the next call in sequence (must be called in recording order). */
export function pushCall(tracker: StateTracker, call: GLCall): GLState {
  const prev = tracker.snapshots.length > 0 ? tracker.snapshots[tracker.snapshots.length - 1] : tracker.initial;
  const next = applyCall(prev, call);
  tracker.snapshots.push(next);
  return next;
}

/** Rebuilds all snapshots from a full call list (e.g. after loading a recording). */
export function resetStateTracker(tracker: StateTracker, calls: readonly GLCall[]): void {
  tracker.snapshots = [];
  for (const call of calls) pushCall(tracker, call);
}

/** State immediately after `calls[index]`. Pass -1 (or call before any pushCall) for the initial state. */
export function stateAt(tracker: StateTracker, index: number): GLState {
  if (index < 0 || tracker.snapshots.length === 0) return tracker.initial;
  const clamped = Math.min(index, tracker.snapshots.length - 1);
  return tracker.snapshots[clamped];
}
