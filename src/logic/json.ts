/** JSON helpers that ignore key order, so equal data always compares equal. */

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** JSON with object keys sorted; `undefined` fields are dropped, as in JSON.stringify. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'undefined';
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return a === b || stableStringify(a) === stableStringify(b);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Drops later items whose id was already seen. */
export function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && !!seen.add(item.id));
}
