import type { PaginatedResult, PaginationOptions } from '../core/types.js';

const DEFAULT_LIMIT = 25;

/** Slices an already-fetched array into a page and encodes an opaque offset cursor. */
export function paginateArray<T>(items: T[], options?: PaginationOptions): PaginatedResult<T> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const offset = decodeCursor(options?.cursor) ?? ((options?.page ?? 1) - 1) * limit;

  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < items.length;

  return {
    items: page,
    hasMore,
    nextCursor: hasMore ? encodeCursor(nextOffset) : undefined,
    total: items.length,
  };
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function decodeCursor(cursor?: string): number | undefined {
  if (!cursor) return undefined;
  const decoded = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  return Number.isFinite(decoded) && decoded >= 0 ? decoded : undefined;
}
