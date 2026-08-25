import type { GLObjectRef } from './types.js';

/**
 * Assigns stable, sequential debugger ids to opaque WebGL handle objects
 * (WebGLTexture, WebGLBuffer, WebGLProgram, WebGLUniformLocation, ...).
 *
 * WebGLUniformLocation instances are not guaranteed to be reference-stable
 * across repeated getUniformLocation calls in every implementation, but for
 * a single recorded object the same instance is what's passed around, so a
 * WeakMap keyed by identity is sufficient here.
 */
export interface ObjectRegistry {
  ids: WeakMap<object, GLObjectRef>;
  byId: Map<number, object>;
  nextId: number;
}

export function createObjectRegistry(): ObjectRegistry {
  return { ids: new WeakMap(), byId: new Map(), nextId: 1 };
}

/** Register `obj` as newly created, assigning it a fresh id. Re-registering an already-known object returns its existing ref unchanged. */
export function registerObject(registry: ObjectRegistry, obj: object, type: string): GLObjectRef {
  const existing = registry.ids.get(obj);
  if (existing) return existing;
  const ref: GLObjectRef = { id: registry.nextId++, type, origin: 'created' };
  registry.ids.set(obj, ref);
  registry.byId.set(ref.id, obj);
  return ref;
}

/** Look up the ref for `obj`, lazily assigning an "unknown origin" id if it was never registered via registerObject(). */
export function resolveObject(registry: ObjectRegistry, obj: object, type: string): GLObjectRef {
  const existing = registry.ids.get(obj);
  if (existing) return existing;
  const ref: GLObjectRef = { id: registry.nextId++, type, origin: 'unknown' };
  registry.ids.set(obj, ref);
  registry.byId.set(ref.id, obj);
  return ref;
}

export function lookupObject(registry: ObjectRegistry, obj: object): GLObjectRef | undefined {
  return registry.ids.get(obj);
}

/** The inverse of registerObject()/resolveObject() — recovers the real object behind a previously issued id, e.g. for replay. */
export function objectById(registry: ObjectRegistry, id: number): object | undefined {
  return registry.byId.get(id);
}
