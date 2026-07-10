import { createHash } from 'node:crypto';

/** Deterministic JSON serialisation: object keys sorted recursively so that
 * `{a:1,b:2}` and `{b:2,a:1}` hash identically. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function fingerprint(parts: (string | undefined)[]): string {
  return sha256Hex(parts.map((p) => p ?? '').join('|'));
}
