import { describe, expect, it } from 'vitest';

import { apiClient } from '../src/lib/apiClient.js';

describe('apiClient (axios instance)', () => {
  it('uses /api as baseURL (same-origin: Vite proxy in dev, Vercel rewrites in prod)', () => {
    expect(apiClient.defaults.baseURL).toBe('/api');
  });

  it('sets withCredentials: true so HttpOnly refresh cookies are sent', () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it('has a non-zero timeout so requests cannot hang forever', () => {
    expect(apiClient.defaults.timeout).toBeGreaterThan(0);
  });
});
