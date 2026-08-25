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
function findRedundantClears(calls: readonly GLCall[]): Set<number> {
  const redundant = new Set<number>();
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
      if (prev && (prev.mask & mask) === prev.mask) redundant.add(prev.id);
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
 * True if `call` sets some piece of tracked GL state (a bind, a capability,
 * a raster/blend param, a clear value, a pixel-store param) to the exact
 * value it already holds — a pure no-op, unconditionally safe to flag since
 * it's a direct before/after comparison, not a guess about later usage.
 */
function isNoOpStateChange(call: GLCall, before: GLState): boolean {
  switch (call.name) {
    case 'bindBuffer': {
      const target = BUFFER_TARGETS[argNumber(call, 0)];
      if (!target) return false;
      return refId((before.bufferBindings as Record<string, GLObjectRef | null>)[target]) === argObjectId(call, 1);
    }
    case 'bindTexture': {
      const target = TEXTURE_TARGETS[argNumber(call, 0)];
      if (!target) return false;
      const unit = before.textureUnits[before.activeTextureUnit];
      const current = unit ? refId((unit as unknown as Record<string, GLObjectRef | null>)[target]) : null;
      return current === argObjectId(call, 1);
    }
    case 'bindFramebuffer': {
      const target = FRAMEBUFFER_TARGETS[argNumber(call, 0)];
      if (!target) return false;
      const newId = argObjectId(call, 1);
      if (target === 'FRAMEBUFFER') {
        return refId(before.framebufferBindings.DRAW_FRAMEBUFFER) === newId && refId(before.framebufferBindings.READ_FRAMEBUFFER) === newId;
      }
      return refId((before.framebufferBindings as Record<string, GLObjectRef | null>)[target]) === newId;
    }
    case 'bindRenderbuffer':
      return refId(before.renderbufferBinding) === argObjectId(call, 1);
    case 'bindVertexArray':
    case 'bindVertexArrayOES':
      return refId(before.vertexArrayBinding) === argObjectId(call, 0);
    case 'useProgram':
      return refId(before.currentProgram) === argObjectId(call, 0);
    case 'activeTexture':
      return argNumber(call, 0) - 0x84c0 === before.activeTextureUnit; // 0x84c0 = TEXTURE0
    case 'enable':
      return before.capabilities[CAPABILITIES[argNumber(call, 0)]] === true;
    case 'disable':
      return before.capabilities[CAPABILITIES[argNumber(call, 0)]] === false;
    case 'viewport':
      return sameRect(before.viewport, call);
    case 'scissor':
      return sameRect(before.scissorBox, call);
    case 'clearColor':
      return [0, 1, 2, 3].every((i) => before.clearColor[i] === argNumber(call, i));
    case 'clearDepth':
      return before.clearDepth === argNumber(call, 0);
    case 'clearStencil':
      return before.clearStencil === argNumber(call, 0);
    case 'depthFunc':
      return before.depth.func.raw === argNumber(call, 0);
    case 'depthMask':
      return before.depth.mask === argBool(call, 0);
    case 'cullFace':
      return before.cull.mode.raw === argNumber(call, 0);
    case 'frontFace':
      return before.cull.frontFace.raw === argNumber(call, 0);
    case 'blendFunc':
      return (
        before.blend.srcRGB.raw === argNumber(call, 0) &&
        before.blend.dstRGB.raw === argNumber(call, 1) &&
        before.blend.srcAlpha.raw === argNumber(call, 0) &&
        before.blend.dstAlpha.raw === argNumber(call, 1)
      );
    case 'blendFuncSeparate':
      return (
        before.blend.srcRGB.raw === argNumber(call, 0) &&
        before.blend.dstRGB.raw === argNumber(call, 1) &&
        before.blend.srcAlpha.raw === argNumber(call, 2) &&
        before.blend.dstAlpha.raw === argNumber(call, 3)
      );
    case 'blendEquation':
      return before.blend.equationRGB.raw === argNumber(call, 0) && before.blend.equationAlpha.raw === argNumber(call, 0);
    case 'blendEquationSeparate':
      return before.blend.equationRGB.raw === argNumber(call, 0) && before.blend.equationAlpha.raw === argNumber(call, 1);
    case 'pixelStorei': {
      const pname = argNumber(call, 0);
      const name = PIXEL_STORE_PARAMS[pname] ?? `0x${pname.toString(16)}`;
      return before.pixelStore[name] === call.args[1]?.raw;
    }
    default:
      return false;
  }
}

/** Flags bind calls and state setters that assign a value identical to what's already set — see isNoOpStateChange. */
function findNoOpStateChanges(calls: readonly GLCall[], stateTracker: StateTracker): Set<number> {
  const redundant = new Set<number>();
  calls.forEach((call, i) => {
    if (call.threwError) return;
    if (isNoOpStateChange(call, stateTracker.getStateAt(i - 1))) redundant.add(call.id);
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
function findNoOpUniformSets(calls: readonly GLCall[]): Set<number> {
  const redundant = new Set<number>();
  const lastValueByLocation = new Map<number, string>();

  for (const call of calls) {
    if (call.threwError || !call.name.startsWith('uniform')) continue;
    const locationId = argObjectId(call, 0);
    if (locationId === null) continue;

    const value = JSON.stringify(call.args.slice(1).map((a) => a.raw));
    if (lastValueByLocation.get(locationId) === value) redundant.add(call.id);
    lastValueByLocation.set(locationId, value);
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

/**
 * Flags calls that had no effect on the frame's final visible output: see
 * findRedundantClears, findUnusedRenderTargetWrites, findNoOpStateChanges,
 * findNoOpUniformSets, and findDegenerateDraws.
 */
export function findRedundantCalls(calls: readonly GLCall[], stateTracker: StateTracker): Set<number> {
  const redundant = findRedundantClears(calls);
  for (const id of findUnusedRenderTargetWrites(calls, stateTracker)) redundant.add(id);
  for (const id of findNoOpStateChanges(calls, stateTracker)) redundant.add(id);
  for (const id of findNoOpUniformSets(calls)) redundant.add(id);
  for (const id of findDegenerateDraws(calls)) redundant.add(id);
  return redundant;
}
