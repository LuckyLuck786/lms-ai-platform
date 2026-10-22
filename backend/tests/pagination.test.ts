import { describe, it, expect } from 'vitest';
import { pageEnvelope, parsePage } from '../src/utils/pagination';

describe('parsePage', () => {
  it('defaults to the endpoint’s old cap so existing clients see the same page', () => {
    expect(parsePage({}, 50)).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  it('computes the offset from page and limit', () => {
    expect(parsePage({ page: '3', limit: '20' }, 50)).toEqual({ page: 3, limit: 20, offset: 40 });
  });

  it('falls back instead of erroring on junk or out-of-range input', () => {
    expect(parsePage({ page: '0', limit: '-5' }, 50)).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(parsePage({ page: 'abc', limit: '9999' }, 50, 100)).toEqual({
      page: 1,
      limit: 50,
      offset: 0,
    });
  });
});

describe('pageEnvelope', () => {
  it('lifts the window-function total out of every row', () => {
    const env = pageEnvelope(
      [
        { id: 'a', total_count: '7' },
        { id: 'b', total_count: '7' },
      ],
      { page: 2, limit: 2, offset: 2 },
    );
    expect(env).toEqual({ items: [{ id: 'a' }, { id: 'b' }], total: 7, page: 2, limit: 2 });
  });

  it('reports zero for an empty page', () => {
    expect(pageEnvelope([], { page: 5, limit: 10, offset: 40 })).toEqual({
      items: [],
      total: 0,
      page: 5,
      limit: 10,
    });
  });
});
