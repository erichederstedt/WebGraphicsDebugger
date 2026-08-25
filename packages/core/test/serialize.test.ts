import { describe, expect, it } from 'vitest';
import { serializeValue } from '../src/serialize.js';
import { ObjectRegistry } from '../src/objectRegistry.js';
import { buildConstantMap } from '../src/glConstants.js';
import { GL_CONSTANTS, makeHandle } from './fixtures/fakeContext.js';

function makeCtx() {
  return { constantMap: buildConstantMap(GL_CONSTANTS), registry: new ObjectRegistry() };
}

describe('serializeValue', () => {
  it('classifies primitives', () => {
    const ctx = makeCtx();
    expect(serializeValue(null, ctx)).toEqual({ kind: 'null', display: 'null', raw: null });
    expect(serializeValue(undefined, ctx)).toEqual({ kind: 'undefined', display: 'undefined', raw: undefined });
    expect(serializeValue(true, ctx)).toEqual({ kind: 'boolean', display: 'true', raw: true });
    expect(serializeValue('hi', ctx)).toEqual({ kind: 'string', display: '"hi"', raw: 'hi' });
  });

  it('classifies a plain number as "number" even when it happens to match a constant, without an enum hint', () => {
    const ctx = makeCtx();
    expect(serializeValue(1234.5, ctx)).toEqual({ kind: 'number', display: '1234.5', raw: 1234.5 });
    // GL_CONSTANTS.TEXTURE_2D is a real constant value, but with no hint it's just a number —
    // this is what prevents ordinary integers (e.g. viewport coordinates) from being misread as enums.
    expect(serializeValue(GL_CONSTANTS.TEXTURE_2D, ctx).kind).toBe('number');
  });

  it('with an "enum" hint, classifies a known constant as "enum" with its name', () => {
    const ctx = makeCtx();
    const result = serializeValue(GL_CONSTANTS.TEXTURE_2D, ctx, 'enum');
    expect(result.kind).toBe('enum');
    expect(result.display).toBe('TEXTURE_2D');
    expect(result.raw).toBe(GL_CONSTANTS.TEXTURE_2D);
  });

  it('with an "enum" hint, falls back to plain number display if the value matches no known constant', () => {
    const ctx = makeCtx();
    const result = serializeValue(0x7fffffff, ctx, 'enum');
    expect(result).toEqual({ kind: 'number', display: '2147483647', raw: 0x7fffffff });
  });

  it('joins names when a value is ambiguous across constants (enum hint)', () => {
    const ctx = { constantMap: new Map([[0, ['ZERO', 'POINTS']]]), registry: new ObjectRegistry() };
    const result = serializeValue(0, ctx, 'enum');
    expect(result.kind).toBe('enum');
    expect(result.display).toBe('ZERO|POINTS (0)');
  });

  it('clones typed arrays instead of referencing the original', () => {
    const ctx = makeCtx();
    const original = new Uint8Array([10, 20, 30]);
    const result = serializeValue(original, ctx);
    expect(result.kind).toBe('typedarray');
    expect(result.display).toBe('Uint8Array(3)');
    expect(result.raw).not.toBe(original);
    expect(Array.from(result.raw as Uint8Array)).toEqual([10, 20, 30]);
  });

  it('recursively serializes plain arrays, truncating long ones', () => {
    const ctx = makeCtx();
    const result = serializeValue([42, 7, GL_CONSTANTS.TEXTURE_2D], ctx);
    expect(result.kind).toBe('array');
    expect(result.display).toBe('[42, 7, 3553]');

    const long = Array.from({ length: 40 }, (_, i) => i);
    const truncated = serializeValue(long, ctx);
    expect(truncated.display.endsWith('...]')).toBe(true);
  });

  it('propagates an "enum" hint into array elements', () => {
    const ctx = makeCtx();
    const result = serializeValue([GL_CONSTANTS.TEXTURE_2D, GL_CONSTANTS.TEXTURE_CUBE_MAP], ctx, 'enum');
    expect(result.display).toBe('[TEXTURE_2D, TEXTURE_CUBE_MAP]');
  });

  it('resolves a known GL handle type through the object registry', () => {
    const ctx = makeCtx();
    const buffer = makeHandle('WebGLBuffer');
    ctx.registry.register(buffer, 'WebGLBuffer');
    const result = serializeValue(buffer, ctx);
    expect(result).toEqual({ kind: 'globject', display: 'WebGLBuffer#1', raw: { id: 1, type: 'WebGLBuffer', origin: 'created' } });
  });

  it('treats an unrecognized object type as "other" without assigning an id', () => {
    const ctx = makeCtx();
    const info = { name: 'a_position', size: 1, type: GL_CONSTANTS.FLOAT };
    const result = serializeValue(info, ctx);
    expect(result.kind).toBe('other');
    expect(ctx.registry.lookup(info)).toBeUndefined();
  });
});
