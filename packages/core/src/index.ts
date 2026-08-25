export * from './types.js';
export { createObjectRegistry, registerObject, resolveObject, lookupObject, objectById, type ObjectRegistry } from './objectRegistry.js';
export { buildConstantMap, lookupConstantNames } from './glConstants.js';
export { serializeValue, type SerializeContext, type SerializeHint } from './serialize.js';
export { attachRecorder, type AttachedRecorder, type RecorderOptions } from './recorder.js';
export { ENUM_ARG_INDEX, ENUM_RESULT_METHODS } from './enumArgPositions.js';
export { replayCalls, toReplayArg, FRAMEBUFFER_AFFECTING_METHODS } from './replay.js';
export { findRedundantCalls } from './redundancy.js';

export * from './state/stateModel.js';
export { applyCall } from './state/applyCall.js';
export { createStateTracker, pushCall, resetStateTracker, stateAt, type StateTracker } from './state/stateTracker.js';
export { queryLiveState } from './state/queryLiveState.js';
export * as glEnums from './state/glEnums.js';

import { attachRecorder } from './recorder.js';
import { createStateTracker, pushCall, stateAt, type StateTracker } from './state/stateTracker.js';
import { queryLiveState } from './state/queryLiveState.js';
import { createObjectRegistry, type ObjectRegistry } from './objectRegistry.js';
import type { GLCall, RecordingOptions } from './types.js';
import type { GLState } from './state/stateModel.js';

export interface DebugSession {
  calls: GLCall[];
  stateTracker: StateTracker;
  /** Needed to replay calls against the live context, e.g. for render-target previews. */
  registry: ObjectRegistry;
  detach: () => void;
  /** Convenience: state right after calls[index] (or the initial state for index < 0). */
  getStateAt: (index: number) => GLState;
}

/** Wires a recorder and a state tracker together against a live WebGL context. */
export function attachDebugSession(gl: object, options: RecordingOptions = {}): DebugSession {
  const registry = createObjectRegistry();

  // Best-effort: the frame we're about to record starts from whatever state the page's
  // own (unrecorded) setup code already left the context in, not the GL spec defaults.
  let liveState: Partial<GLState> | undefined;
  try {
    liveState = queryLiveState(gl as WebGL2RenderingContext, registry);
  } catch {
    liveState = undefined; // gl doesn't support the getters this needs (e.g. a test double)
  }

  const stateTracker = createStateTracker(liveState);
  const recorder = attachRecorder(gl, {
    registry,
    onCall: (call) => {
      pushCall(stateTracker, call);
      options.onCall?.(call);
    },
  });

  return {
    calls: recorder.calls,
    stateTracker,
    registry: recorder.registry,
    detach: recorder.detach,
    getStateAt: (index) => stateAt(stateTracker, index),
  };
}
