import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { AuthSuccess, LoginBody, RegisterBody } from '@app/shared';

import { apiClient } from '../../lib/apiClient.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useCartUiStore } from '../../stores/cartUiStore.js';
import { invalidateCart } from '../cart/useCart.js';
import { mergeToastMessage } from '../cart/messages.js';

interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

/** Surface the API's structured ErrorResponse code when present. */
export function authErrorCode(err: unknown): string | null {
  if (err instanceof AxiosError) {
    const data = err.response?.data as ApiErrorPayload | undefined;
    return data?.error?.code ?? null;
  }
  return null;
}

/**
 * Shared post-auth hook: persist the session, surface the cart-merge toast
 * (T3.3), and invalidate the cart cache so the drawer re-reads the merged
 * member cart instead of the guest snapshot it was holding. Side-effects
 * happen on success only — a failed login leaves everything untouched.
 */
function handleAuthSuccess(qc: ReturnType<typeof useQueryClient>, data: AuthSuccess): void {
  useAuthStore.getState().setSession(data.user, data.accessToken);
  const msg = mergeToastMessage(data.cartMergeResult);
  if (msg) useCartUiStore.getState().pushToast('info', msg);
  void invalidateCart(qc);
}

export function useLogin(): UseMutationResult<AuthSuccess, unknown, LoginBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: LoginBody): Promise<AuthSuccess> => {
      const res = await apiClient.post<AuthSuccess>('/auth/login', body);
      handleAuthSuccess(qc, res.data);
      return res.data;
    },
  });
}

export function useRegister(): UseMutationResult<AuthSuccess, unknown, RegisterBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RegisterBody): Promise<AuthSuccess> => {
      const res = await apiClient.post<AuthSuccess>('/auth/register', body);
      handleAuthSuccess(qc, res.data);
      return res.data;
    },
  });
}

export function useLogout(): UseMutationResult<void, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      try {
        await apiClient.post('/auth/logout');
      } finally {
        useAuthStore.getState().clearSession();
        // After logout the FE has no session; the next /cart fetch will mint
        // a fresh guest cart_session. Invalidate so the badge resets.
        void invalidateCart(qc);
      }
    },
  });
}
