/**
 * Reverse lookup from a numeric GL enum value back to its constant name(s),
 * built from whatever context-like object is passed in (a real
 * WebGLRenderingContext/WebGL2RenderingContext, or a test fixture that
 * exposes the same UPPER_SNAKE_CASE numeric properties).
 *
 * Several GL constants intentionally share a numeric value (e.g. 0 is both
 * NONE, ZERO, POINTS, FALSE and NO_ERROR) since their meaning depends on
 * which parameter they're passed to. Rather than guess, ambiguous values map
 * to all matching names.
 */
export function buildConstantMap(source: object): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const key in source as Record<string, unknown>) {
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    const value = (source as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) continue;
    const names = map.get(value);
    if (names) {
      if (!names.includes(key)) names.push(key);
    } else {
      map.set(value, [key]);
    }
  }
  return map;
}

/** Names for `value`, or undefined if it doesn't match any known constant. */
export function lookupConstantNames(map: Map<number, string[]>, value: number): string[] | undefined {
  return map.get(value);
}
