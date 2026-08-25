import { vi } from 'vitest';
import * as glEnums from '../../src/state/glEnums.js';
import { ALL_WEBGL_METHODS } from './methodNames.js';

function invert(table: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [num, name] of Object.entries(table)) out[name] = Number(num);
  return out;
}

/** GL constants used by the state module, derived from the same tables it uses internally so fixtures and production code can't drift. */
export const GL_CONSTANTS: Record<string, number> = {
  ...invert(glEnums.BUFFER_TARGETS),
  ...invert(glEnums.TEXTURE_TARGETS),
  ...invert(glEnums.FRAMEBUFFER_TARGETS),
  ...invert(glEnums.CAPABILITIES),
  ...invert(glEnums.BLEND_FACTORS),
  ...invert(glEnums.BLEND_EQUATIONS),
  ...invert(glEnums.COMPARE_FUNCS),
  ...invert(glEnums.CULL_FACE_MODES),
  ...invert(glEnums.FRONT_FACE_MODES),
  ...invert(glEnums.DATA_TYPES),
  ...invert(glEnums.PIXEL_STORE_PARAMS),
  RENDERBUFFER: glEnums.RENDERBUFFER,
  TEXTURE0: glEnums.TEXTURE0,
  TEXTURE1: glEnums.TEXTURE0 + 1,
  TEXTURE2: glEnums.TEXTURE0 + 2,
  TRIANGLES: 0x0004,
  COLOR_BUFFER_BIT: 0x4000,
  DEPTH_BUFFER_BIT: 0x0100,
  STATIC_DRAW: 0x88e4,
  NO_ERROR: 0,
};

/** A stand-in for WebGLTexture/WebGLBuffer/etc so `constructor.name` matches what serialize.ts looks for. */
export function makeHandle(typeName: string): object {
  const ctor = { [typeName]: class {} }[typeName];
  return new ctor();
}

export type FakeContext = Record<string, unknown>;

/**
 * A fresh fake WebGL context exposing every real WebGL1+WebGL2 method as its
 * own vi.fn() (so each test gets isolated mocks, no shared prototype state)
 * plus the numeric constants recorder/glConstants/state code look for.
 */
export function createFakeContext(overrides: Record<string, (...args: unknown[]) => unknown> = {}): FakeContext {
  const ctx: FakeContext = { ...GL_CONSTANTS };
  for (const name of ALL_WEBGL_METHODS) {
    ctx[name] = vi.fn(overrides[name]);
  }
  return ctx;
}
