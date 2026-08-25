import type { GLCall } from '../types.js';
import { applyCall } from './applyCall.js';
import { createInitialState, type GLState } from './stateModel.js';

/**
 * Maintains one GLState snapshot per recorded call so the UI can "rewind" to
 * any point in the recording in O(1). Snapshots share structure (only the
 * branches touched by applyCall are cloned), so this stays cheap even for
 * long recordings.
 */
export class StateTracker {
  private snapshots: GLState[] = [];
  private initial: GLState;

  constructor(initialState: Partial<GLState> = {}) {
    this.initial = createInitialState(initialState);
  }

  /** Feed the next call in sequence (must be called in recording order). */
  push(call: GLCall): GLState {
    const prev = this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : this.initial;
    const next = applyCall(prev, call);
    this.snapshots.push(next);
    return next;
  }

  /** Rebuilds all snapshots from a full call list (e.g. after loading a recording). */
  reset(calls: readonly GLCall[]): void {
    this.snapshots = [];
    for (const call of calls) this.push(call);
  }

  /** State immediately after `calls[index]`. Pass -1 (or call before any push) for the initial state. */
  getStateAt(index: number): GLState {
    if (index < 0 || this.snapshots.length === 0) return this.initial;
    const clamped = Math.min(index, this.snapshots.length - 1);
    return this.snapshots[clamped];
  }

  get length(): number {
    return this.snapshots.length;
  }
}
