import type { ObjectRegistry } from '../objectRegistry.js';
import type { GLObjectRef } from '../types.js';
import { BLEND_EQUATIONS, BLEND_FACTORS, CAPABILITIES, COMPARE_FUNCS, CULL_FACE_MODES, DATA_TYPES, FRONT_FACE_MODES } from './glEnums.js';
import { createEmptyTextureUnit, enumValue, type GLState, type VertexAttribState } from './stateModel.js';

function ref(registry: ObjectRegistry, obj: unknown): GLObjectRef | null {
  if (!obj) return null;
  const ctorName = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
  return registry.resolve(obj as object, ctorName);
}

function rect(v: Int32Array | number[]): { x: number; y: number; width: number; height: number } {
  return { x: v[0], y: v[1], width: v[2], height: v[3] };
}

/**
 * Reads the WebGL context's *actual current* state directly via its getters
 * (getParameter, getVertexAttrib, isEnabled, ...), rather than assuming spec
 * defaults. Meant to seed the "before call 0" baseline for a capture that
 * starts mid-session, after the page's own setup code already bound things.
 */
export function queryLiveState(gl: WebGL2RenderingContext, registry: ObjectRegistry): GLState {
  const activeTextureUnit = gl.getParameter(gl.ACTIVE_TEXTURE) - gl.TEXTURE0;
  const textureUnits = [];
  for (let i = 0; i <= activeTextureUnit; i++) textureUnits.push(createEmptyTextureUnit());
  // ponytail: only the currently active unit is probed (no side-effect-prone activeTexture-and-restore
  // loop over every unit) — other units surface once the capture itself references them.
  textureUnits[activeTextureUnit] = {
    TEXTURE_2D: ref(registry, gl.getParameter(gl.TEXTURE_BINDING_2D)),
    TEXTURE_CUBE_MAP: ref(registry, gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP)),
    TEXTURE_3D: ref(registry, gl.getParameter(gl.TEXTURE_BINDING_3D)),
    TEXTURE_2D_ARRAY: ref(registry, gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY)),
  };

  const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
  const vertexAttribs: VertexAttribState[] = [];
  for (let i = 0; i < maxAttribs; i++) {
    vertexAttribs.push({
      enabled: gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED) as boolean,
      buffer: ref(registry, gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)),
      size: gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_SIZE) as number,
      type: enumValue(gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_TYPE) as number, DATA_TYPES),
      normalized: gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED) as boolean,
      stride: gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_STRIDE) as number,
      offset: gl.getVertexAttribOffset(i, gl.VERTEX_ATTRIB_ARRAY_POINTER),
    });
  }

  const capabilities: Record<string, boolean> = {};
  for (const [raw, name] of Object.entries(CAPABILITIES)) capabilities[name] = gl.isEnabled(Number(raw));

  const clearColorV = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;

  return {
    bufferBindings: {
      ARRAY_BUFFER: ref(registry, gl.getParameter(gl.ARRAY_BUFFER_BINDING)),
      ELEMENT_ARRAY_BUFFER: ref(registry, gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING)),
      COPY_READ_BUFFER: ref(registry, gl.getParameter(gl.COPY_READ_BUFFER_BINDING)),
      COPY_WRITE_BUFFER: ref(registry, gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING)),
      TRANSFORM_FEEDBACK_BUFFER: ref(registry, gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING)),
      UNIFORM_BUFFER: ref(registry, gl.getParameter(gl.UNIFORM_BUFFER_BINDING)),
      PIXEL_PACK_BUFFER: ref(registry, gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)),
      PIXEL_UNPACK_BUFFER: ref(registry, gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING)),
    },
    activeTextureUnit,
    textureUnits,
    currentProgram: ref(registry, gl.getParameter(gl.CURRENT_PROGRAM)),
    framebufferBindings: {
      FRAMEBUFFER: ref(registry, gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),
      DRAW_FRAMEBUFFER: ref(registry, gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)),
      READ_FRAMEBUFFER: ref(registry, gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)),
    },
    renderbufferBinding: ref(registry, gl.getParameter(gl.RENDERBUFFER_BINDING)),
    vertexArrayBinding: ref(registry, gl.getParameter(gl.VERTEX_ARRAY_BINDING)),
    vertexAttribs,
    viewport: rect(gl.getParameter(gl.VIEWPORT) as Int32Array),
    scissorBox: rect(gl.getParameter(gl.SCISSOR_BOX) as Int32Array),
    clearColor: [clearColorV[0], clearColorV[1], clearColorV[2], clearColorV[3]],
    clearDepth: gl.getParameter(gl.DEPTH_CLEAR_VALUE) as number,
    clearStencil: gl.getParameter(gl.STENCIL_CLEAR_VALUE) as number,
    capabilities,
    blend: {
      srcRGB: enumValue(gl.getParameter(gl.BLEND_SRC_RGB) as number, BLEND_FACTORS),
      dstRGB: enumValue(gl.getParameter(gl.BLEND_DST_RGB) as number, BLEND_FACTORS),
      srcAlpha: enumValue(gl.getParameter(gl.BLEND_SRC_ALPHA) as number, BLEND_FACTORS),
      dstAlpha: enumValue(gl.getParameter(gl.BLEND_DST_ALPHA) as number, BLEND_FACTORS),
      equationRGB: enumValue(gl.getParameter(gl.BLEND_EQUATION_RGB) as number, BLEND_EQUATIONS),
      equationAlpha: enumValue(gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number, BLEND_EQUATIONS),
    },
    depth: {
      func: enumValue(gl.getParameter(gl.DEPTH_FUNC) as number, COMPARE_FUNCS),
      mask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
    },
    cull: {
      mode: enumValue(gl.getParameter(gl.CULL_FACE_MODE) as number, CULL_FACE_MODES),
      frontFace: enumValue(gl.getParameter(gl.FRONT_FACE) as number, FRONT_FACE_MODES),
    },
    pixelStore: {
      PACK_ALIGNMENT: gl.getParameter(gl.PACK_ALIGNMENT) as number,
      UNPACK_ALIGNMENT: gl.getParameter(gl.UNPACK_ALIGNMENT) as number,
      UNPACK_FLIP_Y_WEBGL: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean,
      UNPACK_PREMULTIPLY_ALPHA_WEBGL: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean,
      UNPACK_COLORSPACE_CONVERSION_WEBGL: gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) as number,
      PACK_ROW_LENGTH: gl.getParameter(gl.PACK_ROW_LENGTH) as number,
      PACK_SKIP_ROWS: gl.getParameter(gl.PACK_SKIP_ROWS) as number,
      PACK_SKIP_PIXELS: gl.getParameter(gl.PACK_SKIP_PIXELS) as number,
      UNPACK_ROW_LENGTH: gl.getParameter(gl.UNPACK_ROW_LENGTH) as number,
      UNPACK_SKIP_ROWS: gl.getParameter(gl.UNPACK_SKIP_ROWS) as number,
      UNPACK_SKIP_PIXELS: gl.getParameter(gl.UNPACK_SKIP_PIXELS) as number,
      UNPACK_IMAGE_HEIGHT: gl.getParameter(gl.UNPACK_IMAGE_HEIGHT) as number,
      UNPACK_SKIP_IMAGES: gl.getParameter(gl.UNPACK_SKIP_IMAGES) as number,
    },
  };
}
