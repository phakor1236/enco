import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { AxiosError } from 'axios';
import type { AddCartItemBody, CartDto, UpdateCartItemBody } from '@app/shared';

import { apiClient } from '../../lib/apiClient.js';
import { useCartUiStore } from '../../stores/cartUiStore.js';

import { cartApiErrorMessage } from './messages.js';

export const cartKeys = {
  root: () => ['cart'] as const,
};

export function useCart(): UseQueryResult<CartDto> {
  return useQuery({
    queryKey: cartKeys.root(),
    queryFn: async () => {
      const res = await apiClient.get<CartDto>('/cart');
      return res.data;
    },
  });
}

interface CartApiErrorPayload {
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * Convert an Axios error into the structured `{ code, message, details }`
 * the BE returns. Falls through to `null` so the caller's fallback message
 * fires for non-Axios / shapeless errors.
 */
function extractCartApiError(err: unknown): {
  code: string;
  message: string;
  details?: { available?: number };
} | null {
  if (!(err instanceof AxiosError)) return null;
  const data = err.response?.data as CartApiErrorPayload | undefined;
  if (!data?.error?.code) return null;
  return {
    code: data.error.code,
    message: data.error.message ?? '',
    details: data.error.details as { available?: number } | undefined,
  };
}

/** Push a toast describing the failure; centralizes the AxiosError → zh-Hant path. */
function pushCartErrorToast(err: unknown): void {
  useCartUiStore.getState().pushToast('error', cartApiErrorMessage(extractCartApiError(err)));
}

export function useAddCartItem(): UseMutationResult<CartDto, unknown, AddCartItemBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddCartItemBody): Promise<CartDto> => {
      const res = await apiClient.post<CartDto>('/cart/items', body);
      return res.data;
    },
    onSuccess: (cart) => {
      // Server returns the full updated cart — seed the query cache so the
      // drawer renders immediately without a refetch round-trip.
      qc.setQueryData(cartKeys.root(), cart);
      useCartUiStore.getState().openDrawer();
    },
    onError: pushCartErrorToast,
  });
}

interface UpdateCartItemArgs {
  itemId: string;
  qty: number;
}

export function useUpdateCartItem(): UseMutationResult<CartDto, unknown, UpdateCartItemArgs> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, qty }: UpdateCartItemArgs): Promise<CartDto> => {
      const body: UpdateCartItemBody = { qty };
      const res = await apiClient.patch<CartDto>(`/cart/items/${itemId}`, body);
      return res.data;
    },
    onSuccess: (cart) => {
      qc.setQueryData(cartKeys.root(), cart);
    },
    onError: pushCartErrorToast,
  });
}

export function useRemoveCartItem(): UseMutationResult<CartDto, unknown, { itemId: string }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId }: { itemId: string }): Promise<CartDto> => {
      const res = await apiClient.delete<CartDto>(`/cart/items/${itemId}`);
      return res.data;
    },
    onSuccess: (cart) => {
      qc.setQueryData(cartKeys.root(), cart);
    },
    onError: pushCartErrorToast,
  });
}

/** Invalidate the cart query — call after login/register so the cache reflects
 *  the merged member cart instead of the guest cart it was holding. */
export function invalidateCart(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: cartKeys.root() });
}
