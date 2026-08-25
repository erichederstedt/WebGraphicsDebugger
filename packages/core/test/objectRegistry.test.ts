import { describe, expect, it } from 'vitest';
import { createObjectRegistry, registerObject, resolveObject, lookupObject } from '../src/objectRegistry.js';

describe('ObjectRegistry', () => {
  it('assigns sequential ids starting at 1, per registry instance', () => {
    const registry = createObjectRegistry();
    const a = {};
    const b = {};
    expect(registerObject(registry, a, 'WebGLBuffer').id).toBe(1);
    expect(registerObject(registry, b, 'WebGLTexture').id).toBe(2);
  });

  it('re-registering the same object returns its existing ref unchanged', () => {
    const registry = createObjectRegistry();
    const obj = {};
    const first = registerObject(registry, obj, 'WebGLBuffer');
    const second = registerObject(registry, obj, 'WebGLBuffer');
    expect(second).toBe(first);
  });

  it('resolveObject() lazily assigns an id with origin "unknown" for a never-registered object', () => {
    const registry = createObjectRegistry();
    const obj = {};
    const ref = resolveObject(registry, obj, 'WebGLTexture');
    expect(ref).toEqual({ id: 1, type: 'WebGLTexture', origin: 'unknown' });
  });

  it('resolveObject() returns the existing "created" ref if registerObject() already ran', () => {
    const registry = createObjectRegistry();
    const obj = {};
    const created = registerObject(registry, obj, 'WebGLTexture');
    const resolved = resolveObject(registry, obj, 'WebGLTexture');
    expect(resolved).toBe(created);
    expect(resolved.origin).toBe('created');
  });

  it('lookupObject() returns undefined for an object never seen', () => {
    const registry = createObjectRegistry();
    expect(lookupObject(registry, {})).toBeUndefined();
  });

  it('distinct objects never collide, even with identical shape', () => {
    const registry = createObjectRegistry();
    const a = { x: 1 };
    const b = { x: 1 };
    expect(registerObject(registry, a, 'WebGLBuffer').id).not.toBe(registerObject(registry, b, 'WebGLBuffer').id);
  });
});
