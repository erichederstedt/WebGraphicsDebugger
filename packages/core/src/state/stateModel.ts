import type { GLObjectRef } from '../types.js';
import { BLEND_EQUATIONS, BLEND_FACTORS, COMPARE_FUNCS, CULL_FACE_MODES, FRONT_FACE_MODES } from './glEnums.js';

export interface EnumValue {
  raw: number;
  name: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VertexAttribState {
  enabled: boolean;
  buffer: GLObjectRef | null;
  size: number;
  type: EnumValue | null;
  normalized: boolean;
  stride: number;
  offset: number;
}

export interface TextureUnitState {
  TEXTURE_2D: GLObjectRef | null;
  TEXTURE_CUBE_MAP: GLObjectRef | null;
  TEXTURE_3D: GLObjectRef | null;
  TEXTURE_2D_ARRAY: GLObjectRef | null;
}

export interface GLState {
  bufferBindings: {
    ARRAY_BUFFER: GLObjectRef | null;
    ELEMENT_ARRAY_BUFFER: GLObjectRef | null;
    COPY_READ_BUFFER: GLObjectRef | null;
    COPY_WRITE_BUFFER: GLObjectRef | null;
    TRANSFORM_FEEDBACK_BUFFER: GLObjectRef | null;
    UNIFORM_BUFFER: GLObjectRef | null;
    PIXEL_PACK_BUFFER: GLObjectRef | null;
    PIXEL_UNPACK_BUFFER: GLObjectRef | null;
  };
  activeTextureUnit: number;
  /** Grows lazily as higher texture units are referenced. */
  textureUnits: TextureUnitState[];
  currentProgram: GLObjectRef | null;
  framebufferBindings: {
    FRAMEBUFFER: GLObjectRef | null;
    DRAW_FRAMEBUFFER: GLObjectRef | null;
    READ_FRAMEBUFFER: GLObjectRef | null;
  };
  renderbufferBinding: GLObjectRef | null;
  vertexArrayBinding: GLObjectRef | null;
  /**
   * Attribute pointer/enabled state. Modeled as one flat, "currently active"
   * table rather than per-VAO storage — accurate for the default VAO / no-VAO
   * case, but switching VAOs won't restore each VAO's own attribute state.
   */
  vertexAttribs: VertexAttribState[];
  viewport: Rect;
  scissorBox: Rect;
  clearColor: [number, number, number, number];
  clearDepth: number;
  clearStencil: number;
  capabilities: Record<string, boolean>;
  blend: {
    srcRGB: EnumValue;
    dstRGB: EnumValue;
    srcAlpha: EnumValue;
    dstAlpha: EnumValue;
    equationRGB: EnumValue;
    equationAlpha: EnumValue;
  };
  depth: { func: EnumValue; mask: boolean };
  cull: { mode: EnumValue; frontFace: EnumValue };
  pixelStore: Record<string, number | boolean>;
}

export function enumValue(raw: number, table: Record<number, string>): EnumValue {
  return { raw, name: table[raw] ?? `0x${raw.toString(16)}` };
}

export function createEmptyTextureUnit(): TextureUnitState {
  return { TEXTURE_2D: null, TEXTURE_CUBE_MAP: null, TEXTURE_3D: null, TEXTURE_2D_ARRAY: null };
}

export function createInitialState(overrides: Partial<GLState> = {}): GLState {
  const capabilities: Record<string, boolean> = {
    BLEND: false,
    CULL_FACE: false,
    DEPTH_TEST: false,
    DITHER: true,
    POLYGON_OFFSET_FILL: false,
    SAMPLE_ALPHA_TO_COVERAGE: false,
    SAMPLE_COVERAGE: false,
    SCISSOR_TEST: false,
    STENCIL_TEST: false,
  };

  const base: GLState = {
    bufferBindings: {
      ARRAY_BUFFER: null,
      ELEMENT_ARRAY_BUFFER: null,
      COPY_READ_BUFFER: null,
      COPY_WRITE_BUFFER: null,
      TRANSFORM_FEEDBACK_BUFFER: null,
      UNIFORM_BUFFER: null,
      PIXEL_PACK_BUFFER: null,
      PIXEL_UNPACK_BUFFER: null,
    },
    activeTextureUnit: 0,
    textureUnits: [createEmptyTextureUnit()],
    currentProgram: null,
    framebufferBindings: { FRAMEBUFFER: null, DRAW_FRAMEBUFFER: null, READ_FRAMEBUFFER: null },
    renderbufferBinding: null,
    vertexArrayBinding: null,
    vertexAttribs: [],
    viewport: { x: 0, y: 0, width: 0, height: 0 },
    scissorBox: { x: 0, y: 0, width: 0, height: 0 },
    clearColor: [0, 0, 0, 0],
    clearDepth: 1,
    clearStencil: 0,
    capabilities,
    blend: {
      srcRGB: enumValue(1, BLEND_FACTORS),
      dstRGB: enumValue(0, BLEND_FACTORS),
      srcAlpha: enumValue(1, BLEND_FACTORS),
      dstAlpha: enumValue(0, BLEND_FACTORS),
      equationRGB: enumValue(0x8006, BLEND_EQUATIONS),
      equationAlpha: enumValue(0x8006, BLEND_EQUATIONS),
    },
    depth: { func: enumValue(0x0201, COMPARE_FUNCS), mask: true },
    cull: { mode: enumValue(0x0405, CULL_FACE_MODES), frontFace: enumValue(0x0901, FRONT_FACE_MODES) },
    pixelStore: {},
  };

  return { ...base, ...overrides };
}
