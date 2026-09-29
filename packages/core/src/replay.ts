import { objectById, type ObjectRegistry } from './objectRegistry.js';
import type { GLCall, SerializedArg } from './types.js';

/** Reconstructs a real, replayable argument from its serialized form. */
export function toReplayArg(arg: SerializedArg, registry: ObjectRegistry): unknown {
  if (arg.kind === 'globject') {
    const ref = arg.raw as { id: number };
    return objectById(registry, ref.id) ?? null;
  }
  if (arg.kind === 'other') return undefined; // unsupported type; best-effort
  return arg.raw;
}

export function replayCalls(gl: object, calls: readonly GLCall[], registry: ObjectRegistry, targetCallId: number, handleCommandCall?: (target: Record<string, (...a: unknown[]) => unknown>, call: GLCall, args: unknown[], commandIndex: number, stopAt: number) => void): void {
  const target = gl as Record<string, (...a: unknown[]) => unknown>;
  const stopAt = Math.min(targetCallId, calls.length - 1);
  for (let i = 0; i <= stopAt; i++) {
    const call = calls[i];
    if (call.threwError) continue; // never happened for real; nothing to replay
    const args = call.args.map((a) => toReplayArg(a, registry));
    try {
      if (handleCommandCall) {
        handleCommandCall(target, call, args, i, stopAt);
      }
      else {
        target[call.name](...args);
      }
      /*
      if (debug_mode === DRAW_CALL_DEBUG_MODE.HIGHLIGHT && i === stopAt && isDrawCall(call)) {
        const context = gl as WebGL2RenderingContext;
        const originalProgram = context.getParameter(context.CURRENT_PROGRAM) as WebGLProgram | null;
        const wasDepthTestEnabled = context.isEnabled(context.DEPTH_TEST);
        let highlightProgram: WebGLProgram | null = null;
        try {
          highlightProgram = useHighlightShader(context);
          if (highlightProgram) context.disable(context.DEPTH_TEST);
          target[call.name](...args);
        } finally {
          if (wasDepthTestEnabled) context.enable(context.DEPTH_TEST);
          // A frame can inherit its program without recording useProgram.
          // Leave that program usable for the next replay (or resume).
          context.useProgram(originalProgram);
          if (highlightProgram) context.deleteProgram(highlightProgram);
        }
      } else {
        target[call.name](...args);
      }
      */
    } catch {
      // best-effort: skip calls that fail to replay against current live state
    }
  }
}
