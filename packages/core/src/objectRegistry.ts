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
export class ObjectRegistry {
  private ids = new WeakMap<object, GLObjectRef>();
  private byId = new Map<number, object>();
  private nextId = 1;

  /** Register `obj` as newly created, assigning it a fresh id. Re-registering an already-known object returns its existing ref unchanged. */
  register(obj: object, type: string): GLObjectRef {
    const existing = this.ids.get(obj);
    if (existing) return existing;
    const ref: GLObjectRef = { id: this.nextId++, type, origin: 'created' };
    this.ids.set(obj, ref);
    this.byId.set(ref.id, obj);
    return ref;
  }

  /** Look up the ref for `obj`, lazily assigning an "unknown origin" id if it was never registered via register(). */
  resolve(obj: object, type: string): GLObjectRef {
    const existing = this.ids.get(obj);
    if (existing) return existing;
    const ref: GLObjectRef = { id: this.nextId++, type, origin: 'unknown' };
    this.ids.set(obj, ref);
    this.byId.set(ref.id, obj);
    return ref;
  }

  lookup(obj: object): GLObjectRef | undefined {
    return this.ids.get(obj);
  }

  /** The inverse of register()/resolve() — recovers the real object behind a previously issued id, e.g. for replay. */
  objectById(id: number): object | undefined {
    return this.byId.get(id);
  }
}
