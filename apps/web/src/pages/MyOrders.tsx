import { useState } from 'react';
import { Link } from 'react-router-dom';

import { formatMoney } from '../features/products/format.js';
import { useOrder, useOrders, type OrderStatus } from '../features/checkout/useCheckout.js';
import { useAuthStore } from '../stores/authStore.js';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_ZH: Record<OrderStatus, string> = {
  PENDING: '待付款',
  PAID: '已付款',
  SHIPPED: '已出貨',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUNDED: '已退款',
};

const STATUS_COLOUR: Record<OrderStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  SHIPPED: 'bg-sky-50 text-sky-700 border-sky-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-paper-2 text-ink-soft border-line',
  REFUNDED: 'bg-paper-2 text-ink-soft border-line',
};

function StatusBadge({ status }: { status: OrderStatus }): JSX.Element {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOUR[status]}`}
    >
      {STATUS_ZH[status]}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Order detail panel
// ---------------------------------------------------------------------------

function OrderDetailPanel({ orderId }: { orderId: string }): JSX.Element {
  const { data: order, isLoading, isError } = useOrder(orderId);

  if (isLoading) {
    return <p className="py-6 text-center text-sm text-ink-soft">載入中…</p>;
  }
  if (isError || !order) {
    return (
      <p role="alert" className="py-6 text-center text-sm text-danger">
        無法載入訂單詳情
      </p>
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="mb-3 text-sm font-semibold">商品明細</h3>
      <ul className="mb-3 divide-y divide-line text-sm">
        {order.items.map((item) => {
          const snap = item.skuSnapshot;
          const opts = Object.entries(snap.optionCombination ?? {})
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ');
          return (
            <li key={item.skuId} className="flex justify-between gap-2 py-2">
              <div>
                <p className="text-ink">{snap.productName}</p>
                {opts && <p className="text-xs text-ink-soft">{opts}</p>}
                <p className="text-xs text-ink-soft">×{item.qty}</p>
              </div>
              <span className="tabular-nums">{formatMoney(item.unitPrice)}</span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between text-ink-soft">
          <span>小計</span>
          <span>{formatMoney(order.subtotal)}</span>
        </div>
        {Number(order.discount) > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>折扣</span>
            <span>-{formatMoney(order.discount)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <span>合計</span>
          <span>{formatMoney(order.total)}</span>
        </div>
      </div>

      {order.shippingAddress && (
        <div className="mt-4 text-sm text-ink-soft">
          <p className="mb-1 font-semibold text-ink">收件資訊</p>
          <p>
            {order.shippingAddress['name']} · {order.shippingAddress['phone']}
          </p>
          <p>
            {order.shippingAddress['city']} {order.shippingAddress['addr']}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orders list
// ---------------------------------------------------------------------------

function OrdersList(): JSX.Element {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, isError } = useOrders(page);

  if (isLoading) {
    return <p className="py-16 text-center text-ink-soft">載入中…</p>;
  }
  if (isError) {
    return (
      <p role="alert" className="py-16 text-center text-danger">
        無法載入訂單，請重新整理
      </p>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-ink-soft">還沒有訂單</p>
        <Link to="/products" className="text-primary hover:text-primary-press">
          去逛逛 →
        </Link>
      </div>
    );
  }

  const totalPages = Math.ceil(data.total / data.pageSize);

  return (
    <>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {data.items.map((order) => {
          const isOpen = expanded === order.id;
          return (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : order.id)}
                className="w-full px-5 py-4 text-left hover:bg-paper-2 transition-colors"
                aria-expanded={isOpen}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={order.status} />
                    <span className="text-sm text-ink-soft">{formatDate(order.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-ink-soft">{order.itemCount} 件</span>
                    <span className="font-semibold tabular-nums">{formatMoney(order.total)}</span>
                    <span
                      className="text-ink-soft transition-transform"
                      style={{
                        display: 'inline-block',
                        transform: isOpen ? 'rotate(180deg)' : 'none',
                      }}
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-ink-faint font-mono">{order.id}</p>
              </button>

              {isOpen && (
                <div className="px-5 pb-5">
                  <OrderDetailPanel orderId={order.id} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              setExpanded(null);
            }}
            disabled={page === 1}
            className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← 上一頁
          </button>
          <span className="text-sm text-ink-soft">
            第 {page} / {totalPages} 頁
          </span>
          <button
            type="button"
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1));
              setExpanded(null);
            }}
            disabled={page === totalPages}
            className="rounded-full border border-line px-4 py-1.5 text-sm hover:bg-paper-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一頁 →
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page entry point — also handles /orders/:id directly
// ---------------------------------------------------------------------------

export function MyOrdersPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="mb-4 text-ink-soft">請先登入才能查看訂單</p>
        <Link
          to="/login"
          className="inline-flex h-11 items-center rounded-full bg-ink px-6 font-semibold text-white hover:opacity-90"
        >
          前往登入
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-6 font-display text-2xl font-bold">我的訂單</h1>
      <OrdersList />
    </main>
  );
}
