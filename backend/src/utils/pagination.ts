import { z } from 'zod';

/**
 * Offset pagination for list endpoints.
 *
 * Every list used to stop at a hard-coded LIMIT and return no total, so an
 * admin queue past its cap silently lost rows. `defaultLimit` matches each
 * endpoint's old cap, so a client that sends no paging params sees the same
 * page it always did — now with `total` to know there is more.
 */
export interface Page {
  page: number;
  limit: number;
  offset: number;
}

export function parsePage(
  query: Record<string, unknown>,
  defaultLimit: number,
  maxLimit = 100,
): Page {
  const page = z.coerce.number().int().min(1).catch(1).parse(query.page ?? 1);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(maxLimit)
    .catch(defaultLimit)
    .parse(query.limit ?? defaultLimit);
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Rows selected with `count(*) OVER() AS total_count` carry the unpaged total
 * on every row; strip it and lift it into the envelope.
 */
export function pageEnvelope<T extends { total_count?: number | string }>(
  rows: T[],
  { page, limit }: Page,
): { items: Omit<T, 'total_count'>[]; total: number; page: number; limit: number } {
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items = rows.map(({ total_count: _omit, ...rest }) => rest);
  return { items, total, page, limit };
}
