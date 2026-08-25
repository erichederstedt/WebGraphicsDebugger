import { attachRecorder } from '../../src/recorder.js';
import { createFakeContext, type FakeContext } from '../fixtures/fakeContext.js';
import type { GLCall } from '../../src/types.js';

/** Attaches a recorder to a fresh fake context, runs `setup` against it, and returns the resulting calls. */
export function recordCalls(
  setup: (gl: FakeContext) => void,
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
): { gl: FakeContext; calls: GLCall[] } {
  const gl = createFakeContext(overrides);
  const { calls } = attachRecorder(gl);
  setup(gl);
  return { gl, calls };
}

function call(gl: FakeContext, name: string, ...args: unknown[]): unknown {
  return (gl[name] as (...a: unknown[]) => unknown)(...args);
}

export { call };
