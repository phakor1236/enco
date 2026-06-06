import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

import {
  __resetRefreshSingleflightForTests,
  apiClient,
  createApiClient,
  refreshAccessToken,
  restoreSession,
} from '../src/lib/apiClient.js';
import { useAuthStore } from '../src/stores/authStore.js';

beforeEach(() => {
  useAuthStore.setState({ user: null, accessToken: null, initialized: false });
  __resetRefreshSingleflightForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================================
// Static configuration
// ============================================================================

describe('apiClient configuration', () => {
  it('uses /api baseURL (same-origin via Vite proxy / Vercel rewrites)', () => {
    expect(apiClient.defaults.baseURL).toBe('/api');
  });

  it('sends credentials so HttpOnly refresh cookie travels with requests', () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it('has a finite timeout so requests cannot hang forever', () => {
    expect(apiClient.defaults.timeout).toBeGreaterThan(0);
  });
});

// ============================================================================
// Refresh single-flight
// ============================================================================

describe('refreshAccessToken — single-flight coordination', () => {
  it('fires exactly one /api/auth/refresh request when called N times in parallel', async () => {
    let inflight = 0;
    let peakInflight = 0;
    const postSpy = vi.spyOn(axios, 'post').mockImplementation(async () => {
      inflight += 1;
      peakInflight = Math.max(peakInflight, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return {
        data: { user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, accessToken: 'new-jwt' },
      } as AxiosResponse;
    });

    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(peakInflight).toBe(1);
    expect(results).toEqual(['new-jwt', 'new-jwt', 'new-jwt', 'new-jwt', 'new-jwt']);
    expect(useAuthStore.getState().accessToken).toBe('new-jwt');
    expect(useAuthStore.getState().user?.id).toBe('u-1');
  });

  it('clears the session and returns null when the refresh request fails', async () => {
    useAuthStore
      .getState()
      .setSession({ id: 'u-old', email: 'x@y.z', role: 'CUSTOMER' }, 'old-jwt');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('network'));

    await expect(refreshAccessToken()).resolves.toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('allows a fresh refresh attempt after the previous one settled', async () => {
    const postSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({
        data: { user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, accessToken: 'jwt-1' },
      } as AxiosResponse)
      .mockResolvedValueOnce({
        data: { user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, accessToken: 'jwt-2' },
      } as AxiosResponse);

    expect(await refreshAccessToken()).toBe('jwt-1');
    await new Promise((r) => setTimeout(r, 0)); // let the microtask release the latch
    expect(await refreshAccessToken()).toBe('jwt-2');
    expect(postSpy).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Boot-time session restore
// ============================================================================

describe('restoreSession — boot path', () => {
  it('flips authStore.initialized=true even when refresh fails', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('no cookie'));
    expect(useAuthStore.getState().initialized).toBe(false);

    await restoreSession();

    expect(useAuthStore.getState().initialized).toBe(true);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('hydrates user + accessToken when refresh succeeds (F5 recovery)', async () => {
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        user: { id: 'u-42', email: 'restored@example.com', role: 'CUSTOMER' },
        accessToken: 'restored-jwt',
      },
    } as AxiosResponse);

    await restoreSession();

    expect(useAuthStore.getState().initialized).toBe(true);
    expect(useAuthStore.getState().accessToken).toBe('restored-jwt');
    expect(useAuthStore.getState().user?.id).toBe('u-42');
  });
});

// ============================================================================
// Interceptors — 401 → silent refresh → retry
// ============================================================================

function makeMockAdapter(
  handler: (config: AxiosRequestConfig, callIndex: number) => Promise<Partial<AxiosResponse>>,
): { adapter: AxiosAdapter; callCount: () => number; calls: () => AxiosRequestConfig[] } {
  let count = 0;
  const calls: AxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    const i = count;
    count += 1;
    calls.push(config);
    const partial = await handler(config, i);
    const response: AxiosResponse = {
      status: 200,
      statusText: 'OK',
      data: undefined,
      headers: new AxiosHeaders(),
      config: config as never,
      ...partial,
    } as AxiosResponse;
    // Mimic axios's own validateStatus check (defaults to 2xx). Throwing here
    // is what would happen inside dispatchRequest after a real adapter call.
    const validate = config.validateStatus ?? ((s: number) => s >= 200 && s < 300);
    if (!validate(response.status)) {
      const err = new axios.AxiosError(
        `Request failed with status code ${response.status}`,
        String(response.status),
        config as never,
        null,
        response,
      );
      throw err;
    }
    return response;
  };
  return { adapter, callCount: () => count, calls: () => calls };
}

describe('apiClient interceptors', () => {
  it('attaches Bearer access token when authStore has one', async () => {
    useAuthStore.getState().setSession({ id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, 'tok-abc');
    const { adapter, calls } = makeMockAdapter(async () => ({ data: { ok: true } }));
    const client = createApiClient();
    client.defaults.adapter = adapter;

    await client.get('/products');

    expect((calls()[0]?.headers as AxiosHeaders | undefined)?.get('Authorization')).toBe(
      'Bearer tok-abc',
    );
  });

  it('does NOT add Authorization when accessToken is null', async () => {
    const { adapter, calls } = makeMockAdapter(async () => ({ data: { ok: true } }));
    const client = createApiClient();
    client.defaults.adapter = adapter;

    await client.get('/public');

    expect((calls()[0]?.headers as AxiosHeaders | undefined)?.get('Authorization')).toBeUndefined();
  });

  it('on 401, silently refreshes once and retries the original request', async () => {
    useAuthStore
      .getState()
      .setSession({ id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, 'old-token');
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' },
        accessToken: 'fresh-token',
      },
    } as AxiosResponse);

    const { adapter, calls } = makeMockAdapter(async (_config, i) => {
      // First call: 401 (stale token). Second call (retry): 200.
      if (i === 0) {
        return { status: 401, data: { error: { code: 'TOKEN_EXPIRED', message: 'x' } } };
      }
      return { status: 200, data: { ok: true } };
    });
    const client = createApiClient();
    client.defaults.adapter = adapter;

    const res = await client.get('/protected');
    expect(res.status).toBe(200);
    expect(calls()).toHaveLength(2);
    expect((calls()[1]?.headers as AxiosHeaders | undefined)?.get('Authorization')).toBe(
      'Bearer fresh-token',
    );
  });

  it('does NOT retry /api/auth/* endpoints on 401 (avoids refresh-of-refresh loops)', async () => {
    const refreshSpy = vi.spyOn(axios, 'post');
    const { adapter, callCount } = makeMockAdapter(async () => ({
      status: 401,
      data: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } },
    }));
    const client = createApiClient();
    client.defaults.adapter = adapter;

    await expect(client.post('/auth/login', { email: 'x', password: 'y' })).rejects.toThrow();
    expect(callCount()).toBe(1); // not retried
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('parallel 401s on different requests share one refresh round-trip', async () => {
    useAuthStore
      .getState()
      .setSession({ id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, 'old-token');
    const refreshSpy = vi.spyOn(axios, 'post').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return {
        data: {
          user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' },
          accessToken: 'fresh-token',
        },
      } as AxiosResponse;
    });

    // 5 separate request URLs, each 401 once then 200 on retry. Track per-URL
    // call count so two requests' 401s don't somehow chain.
    const perUrlCalls = new Map<string, number>();
    const { adapter } = makeMockAdapter(async (config) => {
      const n = (perUrlCalls.get(config.url ?? '') ?? 0) + 1;
      perUrlCalls.set(config.url ?? '', n);
      if (n === 1) {
        return { status: 401, data: { error: { code: 'TOKEN_EXPIRED', message: 'x' } } };
      }
      return { status: 200, data: { url: config.url } };
    });
    const client = createApiClient();
    client.defaults.adapter = adapter;

    const responses = await Promise.all([
      client.get('/a'),
      client.get('/b'),
      client.get('/c'),
      client.get('/d'),
      client.get('/e'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('gives up after one refresh attempt — does not loop on a still-401 retry', async () => {
    useAuthStore
      .getState()
      .setSession({ id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' }, 'old-token');
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        user: { id: 'u-1', email: 'a@b.c', role: 'CUSTOMER' },
        accessToken: 'fresh-token',
      },
    } as AxiosResponse);

    let count = 0;
    const { adapter } = makeMockAdapter(async () => {
      count += 1;
      return { status: 401, data: { error: { code: 'INVALID_TOKEN', message: 'x' } } };
    });
    const client = createApiClient();
    client.defaults.adapter = adapter;

    await expect(client.get('/protected')).rejects.toThrow();
    expect(count).toBe(2); // original + 1 retry, no more
  });
});
