import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { useAuthStore, type AuthUser } from '../stores/authStore.js';

/**
 * Single shared Axios instance. Base URL is `/api` so that:
 *  - Dev: Vite proxy in vite.config.ts forwards /api/* to the API origin
 *  - Prod: Vercel rewrites forward /api/* to the deployed API origin
 * Result: FE always looks same-origin -> SameSite=Lax cookies work.
 */

interface RefreshResponse {
  user: AuthUser;
  accessToken: string;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

/**
 * Single-flight refresh promise. While a refresh is in flight, all callers
 * await the same promise — prevents N parallel 401s from firing N refresh
 * requests (which would invalidate each other via reuse detection).
 */
let inflightRefresh: Promise<string | null> | null = null;

/**
 * Bare axios call (no interceptors) so it can't recurse if /refresh itself
 * 401s. Resolves to the new access token, or null when refresh failed (cookie
 * expired / reuse detected / network).
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh;

  inflightRefresh = (async () => {
    try {
      const res = await axios.post<RefreshResponse>(
        '/api/auth/refresh',
        {},
        { withCredentials: true },
      );
      useAuthStore.getState().setSession(res.data.user, res.data.accessToken);
      return res.data.accessToken;
    } catch {
      useAuthStore.getState().clearSession();
      return null;
    } finally {
      // Release after the microtask so any awaiters that arrived during the
      // request finish before a new flight can start.
      queueMicrotask(() => {
        inflightRefresh = null;
      });
    }
  })();

  return inflightRefresh;
}

/**
 * App-boot session restore: if the browser still holds a valid HttpOnly
 * refresh cookie, this re-hydrates user + accessToken into the store.
 * Called once from main.tsx so an F5 doesn't appear to log the user out.
 */
export async function restoreSession(): Promise<void> {
  await refreshAccessToken();
  useAuthStore.getState().setInitialized(true);
}

function applyInterceptors(client: AxiosInstance): void {
  // Inject Bearer access token on every outgoing request when present
  client.interceptors.request.use((config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  // On 401, attempt one refresh + retry. Skip auth endpoints themselves
  // (their 401 is real, not a stale-access-token signal).
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as RetriableConfig | undefined;
      const url = original?.url ?? '';
      const isAuthEndpoint = url.startsWith('/auth/') || url.startsWith('/api/auth/');

      if (error.response?.status !== 401 || !original || original._retry || isAuthEndpoint) {
        return Promise.reject(error);
      }

      original._retry = true;
      const newToken = await refreshAccessToken();
      if (!newToken) {
        return Promise.reject(error);
      }
      original.headers?.set('Authorization', `Bearer ${newToken}`);
      return client(original);
    },
  );
}

export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: '/api',
    withCredentials: true,
    timeout: 15_000,
  });
  applyInterceptors(client);
  return client;
}

export const apiClient: AxiosInstance = createApiClient();

/** Test helper: reset the single-flight latch between tests. */
export function __resetRefreshSingleflightForTests(): void {
  inflightRefresh = null;
}
