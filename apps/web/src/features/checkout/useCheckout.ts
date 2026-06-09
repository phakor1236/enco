import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckoutBodyType, CheckoutResultDto } from '@app/shared';

import { apiClient } from '../../lib/apiClient.js';
import { cartKeys } from '../cart/useCart.js';

// ---------------------------------------------------------------------------
// Response types (mirrors apps/api/src/routes/orders.ts shape)
// ---------------------------------------------------------------------------

export interface OrderListItem {
  id: string;
  status: OrderStatus;
  total: string;
  createdAt: string;
  itemCount: number;
}

export interface OrdersResponse {
  items: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OrderItem {
  skuId: string;
  qty: number;
  unitPrice: string;
  skuSnapshot: {
    code: string;
    productName: string;
    optionCombination: Record<string, string>;
  };
}

export interface OrderDetail {
  id: string;
  status: OrderStatus;
  paymentIntentId: string | null;
  subtotal: string;
  discount: string;
  shippingFee: string;
  total: string;
  shippingAddress: Record<string, string>;
  paymentMethod: string;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  items: OrderItem[];
  paymentStatus: string | null;
}

export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const orderKeys = {
  root: () => ['orders'] as const,
  list: (page: number) => ['orders', 'list', page] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation<CheckoutResultDto, Error, CheckoutBodyType>({
    mutationFn: async (body) => {
      const res = await apiClient.post<CheckoutResultDto>('/checkout', body);
      return res.data;
    },
    onSuccess: () => {
      // Cart row is deleted on the server — invalidate so CartIconButton shows 0.
      void qc.invalidateQueries({ queryKey: cartKeys.root() });
    },
  });
}

export function useOrders(page = 1) {
  return useQuery<OrdersResponse>({
    queryKey: orderKeys.list(page),
    queryFn: async () => {
      const res = await apiClient.get<OrdersResponse>('/orders', {
        params: { page, pageSize: 10 },
      });
      return res.data;
    },
  });
}

export function useOrder(id: string) {
  return useQuery<OrderDetail>({
    queryKey: orderKeys.detail(id),
    queryFn: async () => {
      const res = await apiClient.get<OrderDetail>(`/orders/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
  });
}
