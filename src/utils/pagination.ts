/**
 * Keyset (cursor) pagination helpers. Keyset pagination is used for large,
 * frequently-scrolled lists (search, audit logs) because OFFSET degrades
 * linearly with page depth — a problem at 100k+ rows. The cursor encodes the
 * last-seen sort key; opaque base64 keeps clients from depending on its shape.
 */
export interface PageParams {
  limit: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T = Record<string, unknown>>(cursor?: string): T | null {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function buildPage<T>(rows: T[], limit: number, toCursor: (row: T) => Record<string, unknown>): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeCursor(toCursor(items[items.length - 1])) : null;
  return { items, nextCursor };
}
