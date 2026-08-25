import { objectById, type ObjectRegistry } from './objectRegistry.js';
import type { GLCall, SerializedArg } from './types.js';

/** Method names whose execution can change what's visible in the currently bound framebuffer. */
export const FRAMEBUFFER_AFFECTING_METHODS = new Set([
  'clear',
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
  'blitFramebuffer',
]);

/** Reconstructs a real, replayable argument from its serialized form. */
export function toReplayArg(arg: SerializedArg, registry: ObjectRegistry): unknown {
  if (arg.kind === 'globject') {
    const ref = arg.raw as { id: number };
    return objectById(registry, ref.id) ?? null;
  }
  if (arg.kind === 'other') return undefined; // unsupported type; best-effort
  return arg.raw;
}

/**
 * Re-issues every recorded call against the live `gl` context, which must
 * still hold the same buffers/textures/programs used during capture — true
 * for a paused debug session, since nothing has run since. Calls back after
 * every call that can change the visible framebuffer, so the caller can
 * snapshot it (e.g. for a render-target preview scrubber).
 */
export function replayCalls(gl: object, calls: readonly GLCall[], registry: ObjectRegistry, onFrame: (call: GLCall) => void): void {
  const target = gl as Record<string, (...a: unknown[]) => unknown>;
  for (const call of calls) {
    if (call.threwError) continue; // never happened for real; nothing to replay
    const args = call.args.map((a) => toReplayArg(a, registry));
    try {
      target[call.name](...args);
    } catch {
      // best-effort: skip calls that fail to replay against current live state
    }
    if (FRAMEBUFFER_AFFECTING_METHODS.has(call.name)) onFrame(call);
  }
}
