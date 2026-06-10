import { useState } from 'react';

import { useAuthStore } from '../../stores/authStore.js';
import {
  useAdminOrders,
  useShipOrder,
  useRefundOrder,
  type OrderStatus,
} from '../../features/admin/useAdmin.js';
import { extractApiError } from '../../lib/apiError.js';
import { useCartUiStore } from '../../stores/cartUiStore.js';

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: '待付款',
  PAID: '已付款',
  SHIPPED: '已出貨',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUNDED: '已退款',
};

const ALL_STATUSES: (OrderStatus | '')[] = [
  '',
  'PENDING',
  'PAID',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
];

export function AdminOrdersPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');

  const { data, isLoading } = useAdminOrders(page, statusFilter || undefined);
  const ship = useShipOrder();
  const refund = useRefundOrder();
  const pushToast = useCartUiStore((s) => s.pushToast);

  function handleShip(orderId: string) {
    const carrier = window.prompt('承運商（可留空）') ?? undefined;
    const trackingNo = window.prompt('追蹤號（可留空）') ?? undefined;
    ship.mutate(
      { orderId, carrier: carrier || undefined, trackingNo: trackingNo || undefined },
      { onError: (err) => pushToast('error', extractApiError(err, '出貨失敗')) },
    );
  }

  function handleRefund(orderId: string) {
    if (!window.confirm('確定要退款此訂單？')) return;
    refund.mutate(
      { orderId },
      { onError: (err) => pushToast('error', extractApiError(err, '退款失敗')) },
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">訂單管理</h1>

      {/* Status filter */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-sm border transition-colors ${
              statusFilter === s ? 'bg-ink text-white border-ink' : 'border-line hover:bg-paper-2'
            }`}
          >
            {s === '' ? '全部' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-ink-soft">載入中…</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface">
                <tr>
                  {['訂單 ID', '狀態', '總金額', '品項數', '建立時間', '操作'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.items.map((o) => (
                  <tr key={o.id} className="hover:bg-paper-2">
                    <td className="px-4 py-3 font-mono text-xs">{o.id.slice(0, 8)}…</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs">
                        {STATUS_LABELS[o.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">NT${o.total}</td>
                    <td className="px-4 py-3 text-center">{o.itemCount}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {new Date(o.createdAt).toLocaleDateString('zh-TW')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {o.status === 'PAID' && (
                          <button
                            type="button"
                            onClick={() => handleShip(o.id)}
                            disabled={ship.isPending}
                            className="rounded px-3 py-1 text-xs bg-ink text-white hover:opacity-80 disabled:opacity-50"
                          >
                            出貨
                          </button>
                        )}
                        {isSuperAdmin && ['PAID', 'SHIPPED', 'COMPLETED'].includes(o.status) && (
                          <button
                            type="button"
                            onClick={() => handleRefund(o.id)}
                            disabled={refund.isPending}
                            className="rounded px-3 py-1 text-xs border border-red-400 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            退款
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data?.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                      無訂單資料
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-ink-soft">
                共 {data.total} 筆 · 第 {data.page}/{data.totalPages} 頁
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1}
                  className="rounded px-3 py-1 border border-line disabled:opacity-40 hover:bg-paper-2"
                >
                  上一頁
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= data.totalPages}
                  className="rounded px-3 py-1 border border-line disabled:opacity-40 hover:bg-paper-2"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
