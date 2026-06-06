import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { AuthSuccess, LoginBody, RegisterBody } from '@app/shared';

import { apiClient } from '../../lib/apiClient.js';
import { useAuthStore } from '../../stores/authStore.js';

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

export function useLogin(): UseMutationResult<AuthSuccess, unknown, LoginBody> {
  return useMutation({
    mutationFn: async (body: LoginBody): Promise<AuthSuccess> => {
      const res = await apiClient.post<AuthSuccess>('/auth/login', body);
      useAuthStore.getState().setSession(res.data.user, res.data.accessToken);
      return res.data;
    },
  });
}

export function useRegister(): UseMutationResult<AuthSuccess, unknown, RegisterBody> {
  return useMutation({
    mutationFn: async (body: RegisterBody): Promise<AuthSuccess> => {
      const res = await apiClient.post<AuthSuccess>('/auth/register', body);
      useAuthStore.getState().setSession(res.data.user, res.data.accessToken);
      return res.data;
    },
  });
}

export function useLogout(): UseMutationResult<void, unknown, void> {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      try {
        await apiClient.post('/auth/logout');
      } finally {
        useAuthStore.getState().clearSession();
      }
    },
  });
}
