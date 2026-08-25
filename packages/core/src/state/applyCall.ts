import type { GLCall, GLObjectRef } from '../types.js';
import {
  BLEND_EQUATIONS,
  BLEND_FACTORS,
  BUFFER_TARGETS,
  CAPABILITIES,
  COMPARE_FUNCS,
  CULL_FACE_MODES,
  DATA_TYPES,
  FRAMEBUFFER_TARGETS,
  FRONT_FACE_MODES,
  PIXEL_STORE_PARAMS,
  TEXTURE0,
  TEXTURE_TARGETS,
} from './glEnums.js';
import { createEmptyTextureUnit, enumValue, type GLState, type TextureUnitState, type VertexAttribState } from './stateModel.js';

function argNumber(call: GLCall, i: number): number {
  const a = call.args[i];
  return typeof a?.raw === 'number' ? a.raw : 0;
}

function argBool(call: GLCall, i: number): boolean {
  const a = call.args[i];
  return typeof a?.raw === 'boolean' ? a.raw : false;
}

function argObjectRef(call: GLCall, i: number): GLObjectRef | null {
  const a = call.args[i];
  return a && a.kind === 'globject' ? (a.raw as GLObjectRef) : null;
}

function ensureUnits(units: TextureUnitState[], index: number): TextureUnitState[] {
  if (index < units.length) return units;
  const grown = units.slice();
  while (grown.length <= index) grown.push(createEmptyTextureUnit());
  return grown;
}

function defaultAttrib(): VertexAttribState {
  return { enabled: false, buffer: null, size: 4, type: null, normalized: false, stride: 0, offset: 0 };
}

function ensureAttribs(attribs: VertexAttribState[], index: number): VertexAttribState[] {
  if (index < attribs.length) return attribs;
  const grown = attribs.slice();
  while (grown.length <= index) grown.push(defaultAttrib());
  return grown;
}

function rectFromArgs(call: GLCall) {
  return { x: argNumber(call, 0), y: argNumber(call, 1), width: argNumber(call, 2), height: argNumber(call, 3) };
}

/** Pure reducer: given the state before `call`, returns the state after it. Unrelated calls return the same reference unchanged. */
export function applyCall(state: GLState, call: GLCall): GLState {
  if (call.threwError) return state;

  switch (call.name) {
    case 'bindBuffer': {
      const name = BUFFER_TARGETS[argNumber(call, 0)];
      if (!name) return state;
      return { ...state, bufferBindings: { ...state.bufferBindings, [name]: argObjectRef(call, 1) } };
    }

    case 'activeTexture': {
      const unit = argNumber(call, 0) - TEXTURE0;
      if (unit < 0) return state;
      return { ...state, activeTextureUnit: unit, textureUnits: ensureUnits(state.textureUnits, unit) };
    }

    case 'bindTexture': {
      const name = TEXTURE_TARGETS[argNumber(call, 0)];
      if (!name) return state;
      const units = ensureUnits(state.textureUnits, state.activeTextureUnit).slice();
      units[state.activeTextureUnit] = { ...units[state.activeTextureUnit], [name]: argObjectRef(call, 1) };
      return { ...state, textureUnits: units };
    }

    case 'useProgram':
      return { ...state, currentProgram: argObjectRef(call, 0) };

    case 'bindFramebuffer': {
      const name = FRAMEBUFFER_TARGETS[argNumber(call, 0)];
      if (!name) return state;
      const ref = argObjectRef(call, 1);
      if (name === 'FRAMEBUFFER') {
        return { ...state, framebufferBindings: { FRAMEBUFFER: ref, DRAW_FRAMEBUFFER: ref, READ_FRAMEBUFFER: ref } };
      }
      return { ...state, framebufferBindings: { ...state.framebufferBindings, [name]: ref } };
    }

    case 'bindRenderbuffer':
      return { ...state, renderbufferBinding: argObjectRef(call, 1) };

    case 'bindVertexArray':
    case 'bindVertexArrayOES':
      return { ...state, vertexArrayBinding: argObjectRef(call, 0) };

    case 'enableVertexAttribArray':
    case 'disableVertexAttribArray': {
      const index = argNumber(call, 0);
      const attribs = ensureAttribs(state.vertexAttribs, index).slice();
      attribs[index] = { ...attribs[index], enabled: call.name === 'enableVertexAttribArray' };
      return { ...state, vertexAttribs: attribs };
    }

    case 'vertexAttribPointer': {
      const index = argNumber(call, 0);
      const attribs = ensureAttribs(state.vertexAttribs, index).slice();
      attribs[index] = {
        ...attribs[index],
        buffer: state.bufferBindings.ARRAY_BUFFER,
        size: argNumber(call, 1),
        type: enumValue(argNumber(call, 2), DATA_TYPES),
        normalized: argBool(call, 3),
        stride: argNumber(call, 4),
        offset: argNumber(call, 5),
      };
      return { ...state, vertexAttribs: attribs };
    }

    case 'viewport':
      return { ...state, viewport: rectFromArgs(call) };

    case 'scissor':
      return { ...state, scissorBox: rectFromArgs(call) };

    case 'clearColor':
      return { ...state, clearColor: [argNumber(call, 0), argNumber(call, 1), argNumber(call, 2), argNumber(call, 3)] };

    case 'clearDepth':
      return { ...state, clearDepth: argNumber(call, 0) };

    case 'clearStencil':
      return { ...state, clearStencil: argNumber(call, 0) };

    case 'enable':
    case 'disable': {
      const name = CAPABILITIES[argNumber(call, 0)];
      if (!name) return state;
      return { ...state, capabilities: { ...state.capabilities, [name]: call.name === 'enable' } };
    }

    case 'blendFunc': {
      const src = enumValue(argNumber(call, 0), BLEND_FACTORS);
      const dst = enumValue(argNumber(call, 1), BLEND_FACTORS);
      return { ...state, blend: { ...state.blend, srcRGB: src, dstRGB: dst, srcAlpha: src, dstAlpha: dst } };
    }

    case 'blendFuncSeparate': {
      return {
        ...state,
        blend: {
          ...state.blend,
          srcRGB: enumValue(argNumber(call, 0), BLEND_FACTORS),
          dstRGB: enumValue(argNumber(call, 1), BLEND_FACTORS),
          srcAlpha: enumValue(argNumber(call, 2), BLEND_FACTORS),
          dstAlpha: enumValue(argNumber(call, 3), BLEND_FACTORS),
        },
      };
    }

    case 'blendEquation': {
      const eq = enumValue(argNumber(call, 0), BLEND_EQUATIONS);
      return { ...state, blend: { ...state.blend, equationRGB: eq, equationAlpha: eq } };
    }

    case 'blendEquationSeparate': {
      return {
        ...state,
        blend: {
          ...state.blend,
          equationRGB: enumValue(argNumber(call, 0), BLEND_EQUATIONS),
          equationAlpha: enumValue(argNumber(call, 1), BLEND_EQUATIONS),
        },
      };
    }

    case 'depthFunc':
      return { ...state, depth: { ...state.depth, func: enumValue(argNumber(call, 0), COMPARE_FUNCS) } };

    case 'depthMask':
      return { ...state, depth: { ...state.depth, mask: argBool(call, 0) } };

    case 'cullFace':
      return { ...state, cull: { ...state.cull, mode: enumValue(argNumber(call, 0), CULL_FACE_MODES) } };

    case 'frontFace':
      return { ...state, cull: { ...state.cull, frontFace: enumValue(argNumber(call, 0), FRONT_FACE_MODES) } };

    case 'pixelStorei': {
      const pname = argNumber(call, 0);
      const name = PIXEL_STORE_PARAMS[pname] ?? `0x${pname.toString(16)}`;
      const raw = call.args[1]?.raw;
      const value = typeof raw === 'boolean' || typeof raw === 'number' ? raw : 0;
      return { ...state, pixelStore: { ...state.pixelStore, [name]: value } };
    }

    default:
      return state;
  }
}
