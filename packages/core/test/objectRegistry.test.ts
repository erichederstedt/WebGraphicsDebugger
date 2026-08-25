import { describe, expect, it } from 'vitest';
import { ObjectRegistry } from '../src/objectRegistry.js';

describe('ObjectRegistry', () => {
  it('assigns sequential ids starting at 1, per registry instance', () => {
    const registry = new ObjectRegistry();
    const a = {};
    const b = {};
    expect(registry.register(a, 'WebGLBuffer').id).toBe(1);
    expect(registry.register(b, 'WebGLTexture').id).toBe(2);
  });

  it('re-registering the same object returns its existing ref unchanged', () => {
    const registry = new ObjectRegistry();
    const obj = {};
    const first = registry.register(obj, 'WebGLBuffer');
    const second = registry.register(obj, 'WebGLBuffer');
    expect(second).toBe(first);
  });

  it('resolve() lazily assigns an id with origin "unknown" for a never-registered object', () => {
    const registry = new ObjectRegistry();
    const obj = {};
    const ref = registry.resolve(obj, 'WebGLTexture');
    expect(ref).toEqual({ id: 1, type: 'WebGLTexture', origin: 'unknown' });
  });

  it('resolve() returns the existing "created" ref if register() already ran', () => {
    const registry = new ObjectRegistry();
    const obj = {};
    const created = registry.register(obj, 'WebGLTexture');
    const resolved = registry.resolve(obj, 'WebGLTexture');
    expect(resolved).toBe(created);
    expect(resolved.origin).toBe('created');
  });

  it('lookup() returns undefined for an object never seen', () => {
    const registry = new ObjectRegistry();
    expect(registry.lookup({})).toBeUndefined();
  });

  it('distinct objects never collide, even with identical shape', () => {
    const registry = new ObjectRegistry();
    const a = { x: 1 };
    const b = { x: 1 };
    expect(registry.register(a, 'WebGLBuffer').id).not.toBe(registry.register(b, 'WebGLBuffer').id);
  });
});
