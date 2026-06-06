import { describe, expect, it } from 'vitest';

import { ErrorResponseSchema, type ErrorResponse } from '../src/errors.js';

describe('ErrorResponseSchema', () => {
  it('parses a minimal valid error response (code + message)', () => {
    const parsed = ErrorResponseSchema.parse({
      error: { code: 'OUT_OF_STOCK', message: 'SKU 庫存不足' },
    });
    expect(parsed.error.code).toBe('OUT_OF_STOCK');
    expect(parsed.error.message).toBe('SKU 庫存不足');
    expect(parsed.error.details).toBeUndefined();
  });

  it('parses a response with details payload', () => {
    const parsed = ErrorResponseSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'invalid input',
        details: { field: 'email', reason: 'required' },
      },
    });
    expect(parsed.error.details).toEqual({ field: 'email', reason: 'required' });
  });

  it('rejects response missing the error envelope', () => {
    expect(() => ErrorResponseSchema.parse({ code: 'X', message: 'y' })).toThrow();
  });

  it('rejects empty code (UPPER_SNAKE codes are mandatory)', () => {
    expect(() => ErrorResponseSchema.parse({ error: { code: '', message: 'oops' } })).toThrow();
  });

  it('rejects lowercase code (enforces UPPER_SNAKE convention)', () => {
    expect(() =>
      ErrorResponseSchema.parse({ error: { code: 'out_of_stock', message: 'x' } }),
    ).toThrow();
  });

  it('rejects non-string message', () => {
    expect(() => ErrorResponseSchema.parse({ error: { code: 'X', message: 123 } })).toThrow();
  });

  it('exposes a TypeScript type matching the parsed shape', () => {
    const value: ErrorResponse = { error: { code: 'A', message: 'b' } };
    expect(ErrorResponseSchema.parse(value)).toEqual(value);
  });
});
