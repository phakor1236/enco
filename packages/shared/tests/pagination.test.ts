import { describe, expect, it } from 'vitest';

import { PageRequestSchema, PageResponseSchema } from '../src/pagination.js';

describe('PageRequestSchema (cursor-based)', () => {
  it('applies defaults when fields are omitted', () => {
    const parsed = PageRequestSchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
  });

  it('coerces numeric strings (since query strings arrive as strings)', () => {
    const parsed = PageRequestSchema.parse({ limit: '50' });
    expect(parsed.limit).toBe(50);
  });

  it('clamps limit at 100 (prevents unbounded queries)', () => {
    expect(() => PageRequestSchema.parse({ limit: 500 })).toThrow();
  });

  it('rejects negative or zero limit', () => {
    expect(() => PageRequestSchema.parse({ limit: 0 })).toThrow();
    expect(() => PageRequestSchema.parse({ limit: -1 })).toThrow();
  });

  it('accepts cursor as opaque string', () => {
    const parsed = PageRequestSchema.parse({ cursor: 'opaque-token-xyz' });
    expect(parsed.cursor).toBe('opaque-token-xyz');
  });
});

describe('PageResponseSchema', () => {
  it('wraps an items array with nextCursor (null when no more)', () => {
    const parsed = PageResponseSchema.parse({
      items: [1, 2, 3],
      nextCursor: null,
    });
    expect(parsed.items).toEqual([1, 2, 3]);
    expect(parsed.nextCursor).toBeNull();
  });

  it('accepts a string nextCursor when more pages exist', () => {
    const parsed = PageResponseSchema.parse({
      items: ['a'],
      nextCursor: 'next-token',
    });
    expect(parsed.nextCursor).toBe('next-token');
  });

  it('rejects response missing nextCursor field (must be explicit)', () => {
    expect(() => PageResponseSchema.parse({ items: [] })).toThrow();
  });
});
