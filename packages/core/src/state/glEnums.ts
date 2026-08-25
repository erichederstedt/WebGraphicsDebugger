/**
 * Fixed, spec-stable numeric GL constants needed to branch on and label
 * state-affecting calls. Kept separate from glConstants.ts (which builds a
 * generic reverse lookup from whatever live context is attached) so state
 * tracking has an authoritative source of truth independent of what a given
 * context/test fixture happens to expose.
 */

export const BUFFER_TARGETS: Record<number, string> = {
  0x8892: 'ARRAY_BUFFER',
  0x8893: 'ELEMENT_ARRAY_BUFFER',
  0x8f36: 'COPY_READ_BUFFER',
  0x8f37: 'COPY_WRITE_BUFFER',
  0x8c8e: 'TRANSFORM_FEEDBACK_BUFFER',
  0x8a11: 'UNIFORM_BUFFER',
  0x88eb: 'PIXEL_PACK_BUFFER',
  0x88ec: 'PIXEL_UNPACK_BUFFER',
};

export const TEXTURE_TARGETS: Record<number, string> = {
  0x0de1: 'TEXTURE_2D',
  0x8513: 'TEXTURE_CUBE_MAP',
  0x806f: 'TEXTURE_3D',
  0x8c1a: 'TEXTURE_2D_ARRAY',
};

export const TEXTURE0 = 0x84c0;

export const FRAMEBUFFER_TARGETS: Record<number, string> = {
  0x8d40: 'FRAMEBUFFER',
  0x8ca9: 'DRAW_FRAMEBUFFER',
  0x8ca8: 'READ_FRAMEBUFFER',
};

export const RENDERBUFFER = 0x8d41;

export const CAPABILITIES: Record<number, string> = {
  0x0be2: 'BLEND',
  0x0b44: 'CULL_FACE',
  0x0b71: 'DEPTH_TEST',
  0x0bd0: 'DITHER',
  0x8037: 'POLYGON_OFFSET_FILL',
  0x809e: 'SAMPLE_ALPHA_TO_COVERAGE',
  0x80a0: 'SAMPLE_COVERAGE',
  0x0c11: 'SCISSOR_TEST',
  0x0b90: 'STENCIL_TEST',
};

export const BLEND_FACTORS: Record<number, string> = {
  0: 'ZERO',
  1: 'ONE',
  0x0300: 'SRC_COLOR',
  0x0301: 'ONE_MINUS_SRC_COLOR',
  0x0302: 'SRC_ALPHA',
  0x0303: 'ONE_MINUS_SRC_ALPHA',
  0x0304: 'DST_ALPHA',
  0x0305: 'ONE_MINUS_DST_ALPHA',
  0x0306: 'DST_COLOR',
  0x0307: 'ONE_MINUS_DST_COLOR',
  0x0308: 'SRC_ALPHA_SATURATE',
  0x8001: 'CONSTANT_COLOR',
  0x8002: 'ONE_MINUS_CONSTANT_COLOR',
  0x8003: 'CONSTANT_ALPHA',
  0x8004: 'ONE_MINUS_CONSTANT_ALPHA',
};

export const BLEND_EQUATIONS: Record<number, string> = {
  0x8006: 'FUNC_ADD',
  0x800a: 'FUNC_SUBTRACT',
  0x800b: 'FUNC_REVERSE_SUBTRACT',
  0x8007: 'MIN',
  0x8008: 'MAX',
};

export const COMPARE_FUNCS: Record<number, string> = {
  0x0200: 'NEVER',
  0x0201: 'LESS',
  0x0202: 'EQUAL',
  0x0203: 'LEQUAL',
  0x0204: 'GREATER',
  0x0205: 'NOTEQUAL',
  0x0206: 'GEQUAL',
  0x0207: 'ALWAYS',
};

export const CULL_FACE_MODES: Record<number, string> = {
  0x0404: 'FRONT',
  0x0405: 'BACK',
  0x0408: 'FRONT_AND_BACK',
};

export const FRONT_FACE_MODES: Record<number, string> = {
  0x0900: 'CW',
  0x0901: 'CCW',
};

export const PIXEL_STORE_PARAMS: Record<number, string> = {
  0x0d05: 'PACK_ALIGNMENT',
  0x0cf5: 'UNPACK_ALIGNMENT',
  0x9240: 'UNPACK_FLIP_Y_WEBGL',
  0x9241: 'UNPACK_PREMULTIPLY_ALPHA_WEBGL',
  0x9243: 'UNPACK_COLORSPACE_CONVERSION_WEBGL',
  0x0d02: 'PACK_ROW_LENGTH',
  0x0d03: 'PACK_SKIP_ROWS',
  0x0d04: 'PACK_SKIP_PIXELS',
  0x0cf2: 'UNPACK_ROW_LENGTH',
  0x0cf3: 'UNPACK_SKIP_ROWS',
  0x0cf4: 'UNPACK_SKIP_PIXELS',
  0x806e: 'UNPACK_IMAGE_HEIGHT',
  0x806d: 'UNPACK_SKIP_IMAGES',
};

export const DATA_TYPES: Record<number, string> = {
  0x1400: 'BYTE',
  0x1401: 'UNSIGNED_BYTE',
  0x1402: 'SHORT',
  0x1403: 'UNSIGNED_SHORT',
  0x1404: 'INT',
  0x1405: 'UNSIGNED_INT',
  0x1406: 'FLOAT',
  0x140b: 'HALF_FLOAT',
};

export function nameForEnum(table: Record<number, string>, value: number): string {
  return table[value] ?? `0x${value.toString(16)}`;
}
