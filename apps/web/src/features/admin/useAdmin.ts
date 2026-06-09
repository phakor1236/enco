import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../../lib/apiClient.js';

// ── Key factory ───────────────────────────────────────────────────────────────

export const adminKeys = {
  orders: (page: number, status?: string) => ['admin', 'orders', { page, status }] as const,
  order: (id: string) => ['admin', 'orders', id] as const,
  products: (cursor?: string) => ['admin', 'products', { cursor }] as const,
  coupons: (cursor?: string) => ['admin', 'coupons', { cursor }] as const,
  reports: {
    daily: (days: number) => ['admin', 'reports', 'daily', days] as const,
    monthly: (months: number) => ['admin', 'reports', 'monthly', months] as const,
    byProduct: () => ['admin', 'reports', 'by-product'] as const,
  },
};

// ── Response types ────────────────────────────────────────────────────────────

export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface AdminOrderListItem {
  id: string;
  userId: string;
  status: OrderStatus;
  subtotal: string;
  discount: string;
  shippingFee: string;
  total: string;
  createdAt: string;
  itemCount: number;
}

export interface AdminOrdersResponse {
  items: AdminOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminOrderDetail extends AdminOrderListItem {
  paymentIntentId: string | null;
  shippingAddress: Record<string, string>;
  paymentMethod: string;
  paidAt: string | null;
  shippedAt: string | null;
  paymentStatus: string | null;
  shipment: { carrier: string | null; trackingNo: string | null } | null;
  items: Array<{
    skuId: string;
    qty: number;
    unitPrice: string;
    skuSnapshot: Record<string, unknown>;
  }>;
  statusLogs: Array<{
    fromStatus: string | null;
    toStatus: string;
    operatorId: string | null;
    note: string | null;
    createdAt: string;
  }>;
}

export interface AdminProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  basePrice: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  categoryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductsResponse {
  items: AdminProduct[];
  nextCursor: string | null;
}

export interface AdminCoupon {
  id: string;
  code: string;
  type: 'FIXED' | 'PERCENT';
  value: string;
  minAmount: string | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCouponsResponse {
  items: AdminCoupon[];
  nextCursor: string | null;
}

export interface DailyRow {
  date: string;
  orderCount: number;
  revenue: string;
}

export interface MonthlyRow {
  month: string;
  orderCount: number;
  revenue: string;
}

export interface ProductRow {
  productId: string;
  productName: string;
  totalQty: number;
  revenue: string;
}

// ── Order hooks ───────────────────────────────────────────────────────────────

export function useAdminOrders(page: number, status?: string) {
  return useQuery({
    queryKey: adminKeys.orders(page, status),
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), pageSize: '20' };
      if (status) params.status = status;
      const res = await apiClient.get<AdminOrdersResponse>('/admin/orders', { params });
      return res.data;
    },
  });
}

export function useAdminOrder(id: string) {
  return useQuery({
    queryKey: adminKeys.order(id),
    queryFn: async () => {
      const res = await apiClient.get<AdminOrderDetail>(`/admin/orders/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useShipOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { orderId: string; carrier?: string; trackingNo?: string; note?: string }) =>
      apiClient.post(`/admin/orders/${vars.orderId}/ship`, vars),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      void qc.invalidateQueries({ queryKey: adminKeys.order(vars.orderId) });
    },
  });
}

export function useRefundOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { orderId: string; note?: string }) =>
      apiClient.post(`/admin/orders/${vars.orderId}/refund`, { note: vars.note }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
      void qc.invalidateQueries({ queryKey: adminKeys.order(vars.orderId) });
    },
  });
}

// ── Product hooks ─────────────────────────────────────────────────────────────

export function useAdminProducts() {
  return useQuery({
    queryKey: adminKeys.products(),
    queryFn: async () => {
      const res = await apiClient.get<AdminProductsResponse>('/admin/products?limit=50');
      return res.data;
    },
  });
}

export interface CreateProductBody {
  name: string;
  slug: string;
  description?: string;
  categoryId: string;
  basePrice: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductBody) => apiClient.post<AdminProduct>('/admin/products', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; data: Partial<CreateProductBody> }) =>
      apiClient.patch<AdminProduct>(`/admin/products/${vars.id}`, vars.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
}

export function useArchiveProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
  });
}

export function useAdjustStock() {
  return useMutation({
    mutationFn: (vars: { skuId: string; delta: number }) =>
      apiClient.post<{ skuId: string; stock: number }>(`/admin/skus/${vars.skuId}/adjust-stock`, {
        delta: vars.delta,
      }),
  });
}

// ── Coupon hooks ──────────────────────────────────────────────────────────────

export function useAdminCoupons() {
  return useQuery({
    queryKey: adminKeys.coupons(),
    queryFn: async () => {
      const res = await apiClient.get<AdminCouponsResponse>('/admin/coupons?limit=50');
      return res.data;
    },
  });
}

export interface CreateCouponBody {
  code: string;
  type: 'FIXED' | 'PERCENT';
  value: string;
  minAmount?: string;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCouponBody) => apiClient.post<AdminCoupon>('/admin/coupons', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/coupons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }),
  });
}

// ── Report hooks ──────────────────────────────────────────────────────────────

export function useDailyReport(days: number) {
  return useQuery({
    queryKey: adminKeys.reports.daily(days),
    queryFn: async () => {
      const res = await apiClient.get<{ rows: DailyRow[]; days: number }>(
        `/admin/reports/daily?days=${days}`,
      );
      return res.data;
    },
  });
}

export function useMonthlyReport(months: number) {
  return useQuery({
    queryKey: adminKeys.reports.monthly(months),
    queryFn: async () => {
      const res = await apiClient.get<{ rows: MonthlyRow[]; months: number }>(
        `/admin/reports/monthly?months=${months}`,
      );
      return res.data;
    },
  });
}

export function useByProductReport() {
  return useQuery({
    queryKey: adminKeys.reports.byProduct(),
    queryFn: async () => {
      const res = await apiClient.get<{ rows: ProductRow[] }>('/admin/reports/by-product?limit=20');
      return res.data;
    },
  });
}
