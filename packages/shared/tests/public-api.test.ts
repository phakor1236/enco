import { describe, expect, it } from 'vitest';

import * as shared from '../src/index.js';

describe('@app/shared public API', () => {
  it('re-exports ErrorResponseSchema + ErrorResponse type from src/index', () => {
    expect(typeof shared.ErrorResponseSchema.parse).toBe('function');
  });

  it('re-exports PageRequestSchema + PageResponseSchema', () => {
    expect(typeof shared.PageRequestSchema.parse).toBe('function');
    expect(typeof shared.PageResponseSchema.parse).toBe('function');
  });
});
