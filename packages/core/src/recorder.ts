import { createObjectRegistry, registerObject, type ObjectRegistry } from './objectRegistry.js';
import { buildConstantMap } from './glConstants.js';
import { serializeValue, type SerializeContext } from './serialize.js';
import { ENUM_ARG_INDEX, ENUM_RESULT_METHODS } from './enumArgPositions.js';
import type { GLCall, RecordingOptions } from './types.js';

export interface RecorderOptions extends RecordingOptions {
  /** Reuse an existing registry (e.g. one already seeded by queryLiveState) instead of starting a fresh one. */
  registry?: ObjectRegistry;
}

export interface AttachedRecorder {
  /** Every call recorded so far, in order. Appended to in place — safe to keep a reference. */
  calls: GLCall[];
  registry: ObjectRegistry;
  constantMap: Map<number, string[]>;
  /** Restores every wrapped method to its original implementation. */
  detach: () => void;
}

/** Method names that assign a fresh id in the object registry when they return a handle. */
function assignsObjectId(name: string): boolean {
  return name.startsWith('create') || name === 'getUniformLocation' || name === 'fenceSync';
}

/**
 * Wraps every method reachable on `gl` (own properties and its prototype
 * chain) so calls are recorded. Patches methods in place rather than
 * proxying/replacing `gl` itself, since native WebGL methods throw
 * "Illegal invocation" if invoked with the wrong `this`.
 */
export function attachRecorder(gl: object, options: RecorderOptions = {}): AttachedRecorder {
  const calls: GLCall[] = [];
  const registry = options.registry ?? createObjectRegistry();
  const constantMap = buildConstantMap(gl);
  const ctx: SerializeContext = { constantMap, registry };

  const methodNames = getFunctionPropertyNames(gl);
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  const target = gl as Record<string, (...args: unknown[]) => unknown>;

  for (const name of methodNames) {
    const original = target[name];
    originals.set(name, original);

    target[name] = function wrapped(...args: unknown[]) {
      let result: unknown;
      let threwError: string | undefined;
      try {
        result = original.apply(gl, args);
      } catch (err) {
        threwError = err instanceof Error ? err.message : String(err);
        record(name, args, undefined, threwError);
        throw err;
      }
      record(name, args, result, undefined);
      return result;
    };
  }

  function record(name: string, args: unknown[], result: unknown, threwError: string | undefined) {
    let objectId: number | undefined;
    if (result !== null && typeof result === 'object' && assignsObjectId(name)) {
      const ctorName = (result as { constructor?: { name?: string } }).constructor?.name ?? 'Object';
      objectId = registerObject(registry, result as object, ctorName).id;
    }
    const enumIndices = ENUM_ARG_INDEX[name];
    const call: GLCall = {
      id: calls.length,
      name,
      args: args.map((a, i) => serializeValue(a, ctx, enumIndices?.includes(i) ? 'enum' : undefined)),
      result: result === undefined ? undefined : serializeValue(result, ctx, ENUM_RESULT_METHODS.has(name) ? 'enum' : undefined),
      objectId,
      threwError,
      timestamp: nowMs(),
    };
    calls.push(call);
    options.onCall?.(call);
  }

  return {
    calls,
    registry,
    constantMap,
    detach() {
      for (const [name, original] of originals) {
        target[name] = original;
      }
    },
  };
}

function getFunctionPropertyNames(obj: object): string[] {
  const names = new Set<string>();
  let p: object | null = obj;
  while (p && p !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(p)) {
      if (key === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(p, key);
      if (desc && typeof desc.value === 'function') names.add(key);
    }
    p = Object.getPrototypeOf(p);
  }
  return [...names];
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
