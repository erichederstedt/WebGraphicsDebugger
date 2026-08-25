import type { ObjectRegistry } from './objectRegistry.js';
import type { SerializedArg } from './types.js';
import { lookupConstantNames } from './glConstants.js';

/** Opaque WebGL handle types that get resolved through the ObjectRegistry rather than dumped generically. */
const KNOWN_GL_HANDLE_TYPES = new Set([
  'WebGLBuffer',
  'WebGLFramebuffer',
  'WebGLProgram',
  'WebGLRenderbuffer',
  'WebGLShader',
  'WebGLTexture',
  'WebGLUniformLocation',
  'WebGLVertexArrayObject',
  'WebGLVertexArrayObjectOES',
  'WebGLQuery',
  'WebGLSampler',
  'WebGLSync',
  'WebGLTransformFeedback',
]);

const MAX_ARRAY_ITEMS = 32;

export interface SerializeContext {
  constantMap: Map<number, string[]>;
  registry: ObjectRegistry;
}

/** Pass 'enum' when the caller knows, from the method's spec position, that this value is a GLenum. */
export type SerializeHint = 'enum' | undefined;

export function serializeValue(value: unknown, ctx: SerializeContext, hint?: SerializeHint): SerializedArg {
  if (value === null) return { kind: 'null', display: 'null', raw: null };
  if (value === undefined) return { kind: 'undefined', display: 'undefined', raw: undefined };

  const t = typeof value;
  if (t === 'boolean') return { kind: 'boolean', display: String(value), raw: value };
  if (t === 'string') return { kind: 'string', display: JSON.stringify(value), raw: value };

  if (t === 'number') {
    const n = value as number;
    if (hint === 'enum' && Number.isInteger(n)) {
      const names = lookupConstantNames(ctx.constantMap, n);
      if (names) {
        const display = names.length === 1 ? names[0] : `${names.join('|')} (${n})`;
        return { kind: 'enum', display, raw: n };
      }
    }
    return { kind: 'number', display: String(n), raw: n };
  }

  if (t === 'object') {
    const obj = value as object;

    if (ArrayBuffer.isView(obj)) {
      const typed = obj as ArrayBufferView & ArrayLike<number>;
      const ctorName = (typed as unknown as { constructor: { name: string } }).constructor.name;
      const clone = (typed as unknown as { slice(): ArrayBufferView }).slice();
      return { kind: 'typedarray', display: `${ctorName}(${typed.length})`, raw: clone };
    }
    if (obj instanceof ArrayBuffer) {
      return { kind: 'typedarray', display: `ArrayBuffer(${obj.byteLength})`, raw: obj.slice(0) };
    }
    if (Array.isArray(obj)) {
      const items = obj.slice(0, MAX_ARRAY_ITEMS).map((item) => serializeValue(item, ctx, hint));
      const truncated = obj.length > MAX_ARRAY_ITEMS;
      const display = `[${items.map((i) => i.display).join(', ')}${truncated ? ', ...' : ''}]`;
      return { kind: 'array', display, raw: items.map((i) => i.raw) };
    }

    const ctorName = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
    if (KNOWN_GL_HANDLE_TYPES.has(ctorName)) {
      const ref = ctx.registry.resolve(obj, ctorName);
      return { kind: 'globject', display: `${ref.type}#${ref.id}`, raw: ref };
    }

    return { kind: 'other', display: describeOther(obj, ctorName), raw: undefined };
  }

  return { kind: 'other', display: String(value), raw: undefined };
}

function describeOther(obj: object, ctorName: string): string {
  try {
    const keys = Object.keys(obj).slice(0, 8);
    if (keys.length === 0) return `[${ctorName}]`;
    const parts = keys.map((k) => `${k}: ${String((obj as Record<string, unknown>)[k])}`);
    return `${ctorName} { ${parts.join(', ')} }`;
  } catch {
    return `[${ctorName}]`;
  }
}
