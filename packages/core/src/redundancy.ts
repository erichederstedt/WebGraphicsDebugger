import type { GLCall, GLObjectRef } from './types.js';
import { BUFFER_TARGETS, CAPABILITIES, FRAMEBUFFER_TARGETS, PIXEL_STORE_PARAMS, TEXTURE_TARGETS } from './state/glEnums.js';
import type { GLState, Rect } from './state/stateModel.js';
import type { StateTracker } from './state/stateTracker.js';

const DRAW_METHODS = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']);
const READ_SOURCE_METHODS = new Set(['readPixels', 'blitFramebuffer']);
const OBSERVING_METHODS = new Set([...DRAW_METHODS, ...READ_SOURCE_METHODS]);

const COLOR_BUFFER_BIT = 0x00004000;
const DEPTH_BUFFER_BIT = 0x00000100;
const STENCIL_BUFFER_BIT = 0x00000400;
const CLEAR_MASK = COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT;

function argNumber(call: GLCall, i: number): number {
  const a = call.args[i];
  return typeof a?.raw === 'number' ? a.raw : 0;
}

function argBool(call: GLCall, i: number): boolean {
  const a = call.args[i];
  return typeof a?.raw === 'boolean' ? a.raw : false;
}

function argObjectId(call: GLCall, i: number): number | null {
  const a = call.args[i];
  return a && a.kind === 'globject' ? (a.raw as GLObjectRef).id : null;
}

function fbKey(ref: GLObjectRef | null): number | 'default' {
  return ref ? ref.id : 'default';
}

function refId(ref: GLObjectRef | null): number | null {
  return ref ? ref.id : null;
}

function sameRect(rect: Rect, call: GLCall): boolean {
  return rect.x === argNumber(call, 0) && rect.y === argNumber(call, 1) && rect.width === argNumber(call, 2) && rect.height === argNumber(call, 3);
}

/**
 * Flags `clear` calls whose entire effect was overwritten before anything
 * ever observed it — e.g. clearing the same framebuffer twice in a row with
 * no draw/read in between, so the first clear never painted anything visible.
 *
 * ponytail: tracks one pending clear per framebuffer (keyed by mask), not
 * per bit, so a color-clear followed by a depth-clear followed by a combined
 * clear only catches the depth one as redundant, not both. Same-mask
 * back-to-back clears — the common case — are always caught correctly.
 */
function findRedundantClears(calls: readonly GLCall[]): Map<number, number> {
  const redundant = new Map<number, number>();
  let currentFb: number | 'default' = 'default';
  const pending = new Map<number | 'default', { id: number; mask: number }>();

  for (const call of calls) {
    if (call.threwError) continue;

    if (call.name === 'bindFramebuffer') {
      const target = FRAMEBUFFER_TARGETS[argNumber(call, 0)];
      if (target === 'FRAMEBUFFER' || target === 'DRAW_FRAMEBUFFER') {
        currentFb = argObjectId(call, 1) ?? 'default';
      }
      continue;
    }

    if (OBSERVING_METHODS.has(call.name)) {
      pending.clear(); // conservative: treats any draw/read as observing everything pending so far
      continue;
    }

    if (call.name === 'clear') {
      const mask = argNumber(call, 0) & CLEAR_MASK;
      const prev = pending.get(currentFb);
      if (prev && (prev.mask & mask) === prev.mask) redundant.set(prev.id, call.id);
      pending.set(currentFb, { id: call.id, mask });
    }
  }

  return redundant;
}

/**
 * Flags every call that painted into an offscreen framebuffer (draws and
 * clears) if that framebuffer's contents are never read back — via
 * readPixels/blitFramebuffer — nor any of its attached textures ever bound
 * again for possible sampling. The default framebuffer is always considered
 * used (it's what gets displayed).
 *
 * "Bound for possible sampling" is deliberately lenient (any texture bound
 * while a later draw call happens counts as used, whether or not the active
 * shader actually samples it) — we can't see into shader source from the
 * call log, so erring toward under-flagging avoids false positives on
 * textures that were genuinely sampled.
 */
function findUnusedRenderTargetWrites(calls: readonly GLCall[], stateTracker: StateTracker): Set<number> {
  const paintCallsByFbo = new Map<number | 'default', number[]>();
  const attachmentsByFbo = new Map<number | 'default', Set<number>>();
  const usedFbos = new Set<number | 'default'>(['default']);
  const usedTextureIds = new Set<number>();

  calls.forEach((call, i) => {
    if (call.threwError) return;
    const before = stateTracker.getStateAt(i - 1);

    if (call.name === 'clear' || DRAW_METHODS.has(call.name)) {
      const fb = fbKey(before.framebufferBindings.DRAW_FRAMEBUFFER);
      const list = paintCallsByFbo.get(fb);
      if (list) list.push(call.id);
      else paintCallsByFbo.set(fb, [call.id]);
    }

    if (READ_SOURCE_METHODS.has(call.name)) {
      usedFbos.add(fbKey(before.framebufferBindings.READ_FRAMEBUFFER));
    }

    if (call.name === 'framebufferTexture2D' || call.name === 'framebufferTextureLayer') {
      const target = FRAMEBUFFER_TARGETS[argNumber(call, 0)];
      const fb = fbKey(target === 'READ_FRAMEBUFFER' ? before.framebufferBindings.READ_FRAMEBUFFER : before.framebufferBindings.DRAW_FRAMEBUFFER);
      const textureId = argObjectId(call, call.name === 'framebufferTexture2D' ? 3 : 2);
      if (textureId !== null) {
        const set = attachmentsByFbo.get(fb);
        if (set) set.add(textureId);
        else attachmentsByFbo.set(fb, new Set([textureId]));
      }
    }

    if (DRAW_METHODS.has(call.name)) {
      for (const unit of before.textureUnits) {
        for (const texRef of Object.values(unit)) {
          if (texRef) usedTextureIds.add(texRef.id);
        }
      }
    }
  });

  for (const [fb, textureIds] of attachmentsByFbo) {
    if ([...textureIds].some((id) => usedTextureIds.has(id))) usedFbos.add(fb);
  }

  const redundant = new Set<number>();
  for (const [fb, callIds] of paintCallsByFbo) {
    if (usedFbos.has(fb)) continue;
    for (const id of callIds) redundant.add(id);
  }
  return redundant;
}

/**
 * For a call that sets some piece of tracked GL state (a bind, a capability,
 * a raster/blend param, a clear value, a pixel-store param): the slot key(s)
 * it writes, and whether the value it's setting is identical to what's
 * already there — a pure no-op, unconditionally safe to flag since it's a
 * direct before/after comparison, not a guess about later usage.
 */
function evaluateStateChange(call: GLCall, before: GLState): { keys: string[]; isNoOp: boolean } | null {
  switch (call.name) {
    case 'bindBuffer': {
      const target = BUFFER_TARGETS[argNumber(call, 0)];
      if (!target) return null;
      const isNoOp = refId((before.bufferBindings as Record<string, GLObjectRef | null>)[target]) === argObjectId(call, 1);
      return { keys: [`buffer:${target}`], isNoOp };
    }
    case 'bindTexture': {
      const target = TEXTURE_TARGETS[argNumber(call, 0)];
      if (!target) return null;
      const unit = before.textureUnits[before.activeTextureUnit];
      const current = unit ? refId((unit as unknown as Record<string, GLObjectRef | null>)[target]) : null;
      return { keys: [`texture:${before.activeTextureUnit}:${target}`], isNoOp: current === argObjectId(call, 1) };
    }
    case 'bindFramebuffer': {
      const target = FRAMEBUFFER_TARGETS[argNumber(call, 0)];
      if (!target) return null;
      const newId = argObjectId(call, 1);
      if (target === 'FRAMEBUFFER') {
        const isNoOp = refId(before.framebufferBindings.DRAW_FRAMEBUFFER) === newId && refId(before.framebufferBindings.READ_FRAMEBUFFER) === newId;
        return { keys: ['framebuffer:DRAW_FRAMEBUFFER', 'framebuffer:READ_FRAMEBUFFER'], isNoOp };
      }
      const isNoOp = refId((before.framebufferBindings as Record<string, GLObjectRef | null>)[target]) === newId;
      return { keys: [`framebuffer:${target}`], isNoOp };
    }
    case 'bindRenderbuffer':
      return { keys: ['renderbuffer'], isNoOp: refId(before.renderbufferBinding) === argObjectId(call, 1) };
    case 'bindVertexArray':
    case 'bindVertexArrayOES':
      return { keys: ['vao'], isNoOp: refId(before.vertexArrayBinding) === argObjectId(call, 0) };
    case 'useProgram':
      return { keys: ['program'], isNoOp: refId(before.currentProgram) === argObjectId(call, 0) };
    case 'activeTexture':
      return { keys: ['activeTexture'], isNoOp: argNumber(call, 0) - 0x84c0 === before.activeTextureUnit }; // 0x84c0 = TEXTURE0
    case 'enable':
    case 'disable': {
      const capName = CAPABILITIES[argNumber(call, 0)];
      if (!capName) return null;
      return { keys: [`cap:${capName}`], isNoOp: before.capabilities[capName] === (call.name === 'enable') };
    }
    case 'viewport':
      return { keys: ['viewport'], isNoOp: sameRect(before.viewport, call) };
    case 'scissor':
      return { keys: ['scissor'], isNoOp: sameRect(before.scissorBox, call) };
    case 'clearColor':
      return { keys: ['clearColor'], isNoOp: [0, 1, 2, 3].every((i) => before.clearColor[i] === argNumber(call, i)) };
    case 'clearDepth':
      return { keys: ['clearDepth'], isNoOp: before.clearDepth === argNumber(call, 0) };
    case 'clearStencil':
      return { keys: ['clearStencil'], isNoOp: before.clearStencil === argNumber(call, 0) };
    case 'depthFunc':
      return { keys: ['depthFunc'], isNoOp: before.depth.func.raw === argNumber(call, 0) };
    case 'depthMask':
      return { keys: ['depthMask'], isNoOp: before.depth.mask === argBool(call, 0) };
    case 'cullFace':
      return { keys: ['cullFace'], isNoOp: before.cull.mode.raw === argNumber(call, 0) };
    case 'frontFace':
      return { keys: ['frontFace'], isNoOp: before.cull.frontFace.raw === argNumber(call, 0) };
    case 'blendFunc':
      return {
        keys: ['blendFunc'],
        isNoOp:
          before.blend.srcRGB.raw === argNumber(call, 0) &&
          before.blend.dstRGB.raw === argNumber(call, 1) &&
          before.blend.srcAlpha.raw === argNumber(call, 0) &&
          before.blend.dstAlpha.raw === argNumber(call, 1),
      };
    case 'blendFuncSeparate':
      return {
        keys: ['blendFunc'],
        isNoOp:
          before.blend.srcRGB.raw === argNumber(call, 0) &&
          before.blend.dstRGB.raw === argNumber(call, 1) &&
          before.blend.srcAlpha.raw === argNumber(call, 2) &&
          before.blend.dstAlpha.raw === argNumber(call, 3),
      };
    case 'blendEquation':
      return {
        keys: ['blendEquation'],
        isNoOp: before.blend.equationRGB.raw === argNumber(call, 0) && before.blend.equationAlpha.raw === argNumber(call, 0),
      };
    case 'blendEquationSeparate':
      return {
        keys: ['blendEquation'],
        isNoOp: before.blend.equationRGB.raw === argNumber(call, 0) && before.blend.equationAlpha.raw === argNumber(call, 1),
      };
    case 'pixelStorei': {
      const pname = argNumber(call, 0);
      const name = PIXEL_STORE_PARAMS[pname] ?? `0x${pname.toString(16)}`;
      return { keys: [`pixelStore:${name}`], isNoOp: before.pixelStore[name] === call.args[1]?.raw };
    }
    default:
      return null;
  }
}

/**
 * Flags bind calls and state setters that assign a value identical to what's
 * already set — see evaluateStateChange. Maps each flagged call to the id of
 * the earlier call that already set that same value (or `null` if the value
 * matches the state the capture started with, before call 0).
 */
function findNoOpStateChanges(calls: readonly GLCall[], stateTracker: StateTracker): Map<number, number | null> {
  const redundant = new Map<number, number | null>();
  const lastWriter = new Map<string, number>();

  calls.forEach((call, i) => {
    if (call.threwError) return;
    const evaluated = evaluateStateChange(call, stateTracker.getStateAt(i - 1));
    if (!evaluated) return;
    if (evaluated.isNoOp) redundant.set(call.id, lastWriter.get(evaluated.keys[0]) ?? null);
    for (const key of evaluated.keys) lastWriter.set(key, call.id);
  });

  return redundant;
}

/**
 * Flags `uniform*`/`uniformMatrix*` calls that write the exact same value a
 * location already holds. Keyed by the location's registry id alone — a
 * WebGLUniformLocation is only ever valid for the program it came from, so
 * no separate program-identity tracking is needed, and a program's uniform
 * storage persists across switching to other programs and back.
 */
function findNoOpUniformSets(calls: readonly GLCall[]): Map<number, number> {
  const redundant = new Map<number, number>();
  const lastByLocation = new Map<number, { value: string; callId: number }>();

  for (const call of calls) {
    if (call.threwError || !call.name.startsWith('uniform')) continue;
    const locationId = argObjectId(call, 0);
    if (locationId === null) continue;

    const value = JSON.stringify(call.args.slice(1).map((a) => a.raw));
    const prev = lastByLocation.get(locationId);
    if (prev && prev.value === value) redundant.set(call.id, prev.callId);
    lastByLocation.set(locationId, { value, callId: call.id });
  }

  return redundant;
}

// Argument indices whose value being <= 0 guarantees the draw renders nothing, per spec, regardless of any other state.
const DEGENERATE_DRAW_ARGS: Record<string, number[]> = {
  drawArrays: [2], // count
  drawElements: [1], // count
  drawRangeElements: [3], // count
  drawArraysInstanced: [2, 3], // count, instanceCount
  drawElementsInstanced: [1, 4], // count, instanceCount
};

/** Flags draws that are guaranteed to render nothing (count/instanceCount <= 0) and clear(0), regardless of any other state. */
function findDegenerateDraws(calls: readonly GLCall[]): Set<number> {
  const redundant = new Set<number>();
  for (const call of calls) {
    if (call.threwError) continue;
    if (call.name === 'clear' && (argNumber(call, 0) & CLEAR_MASK) === 0) {
      redundant.add(call.id);
      continue;
    }
    const argIndices = DEGENERATE_DRAW_ARGS[call.name];
    if (argIndices?.some((i) => argNumber(call, i) <= 0)) redundant.add(call.id);
  }
  return redundant;
}

function withoutCause(ids: Set<number>): Map<number, number | null> {
  return new Map([...ids].map((id) => [id, null]));
}

/**
 * Flags calls that had no effect on the frame's final visible output: see
 * findRedundantClears, findUnusedRenderTargetWrites, findNoOpStateChanges,
 * findNoOpUniformSets, and findDegenerateDraws.
 *
 * Maps each flagged call's id to the id of the specific other call that
 * makes it redundant, where there is one (a later clear that supersedes an
 * earlier one, or an earlier call that already set the same state/uniform
 * value) — or `null` when there isn't a single other call to point to (an
 * unused render target, or a draw that's degenerate on its own terms).
 */
export function findRedundantCalls(calls: readonly GLCall[], stateTracker: StateTracker): Map<number, number | null> {
  const merged = new Map<number, number | null>();
  const apply = (entries: Map<number, number | null>) => {
    for (const [id, causedBy] of entries) {
      if (!merged.has(id) || (merged.get(id) === null && causedBy !== null)) merged.set(id, causedBy);
    }
  };

  apply(findRedundantClears(calls));
  apply(withoutCause(findUnusedRenderTargetWrites(calls, stateTracker)));
  apply(findNoOpStateChanges(calls, stateTracker));
  apply(findNoOpUniformSets(calls));
  apply(withoutCause(findDegenerateDraws(calls)));

  return merged;
}
