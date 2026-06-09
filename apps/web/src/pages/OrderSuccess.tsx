import { Link, useParams } from 'react-router-dom';

import { useOrder } from '../features/checkout/useCheckout.js';

const STATUS_ZH: Record<string, string> = {
  PENDING: '待付款',
  PAID: '已付款',
  CANCELLED: '已取消',
};

export function OrderSuccessPage(): JSX.Element {
  const { orderId } = useParams<{ orderId: string }>();
  const { data: order, isLoading } = useOrder(orderId ?? '', {
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 1500 : false),
  });

  return (
    <main className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="mb-6 text-5xl" aria-hidden="true">
        🎉
      </div>
      <h1 className="mb-2 font-display text-2xl font-bold">訂單已建立！</h1>
      <p className="mb-6 text-ink-soft">感謝您的購買，我們已收到您的訂單。</p>

      <div className="mb-8 rounded-xl border border-line bg-surface p-5 text-left text-sm">
        <p className="mb-2 text-ink-soft">訂單編號</p>
        <p className="break-all font-mono text-xs text-ink">{orderId}</p>

        {!isLoading && order && (
          <>
            <p className="mt-4 mb-1 text-ink-soft">訂單狀態</p>
            <p className="font-semibold">{STATUS_ZH[order.status] ?? order.status}</p>

            <p className="mt-4 mb-1 text-ink-soft">付款狀態</p>
            <p className="text-ink-soft text-xs">
              {order.status === 'PENDING'
                ? '付款處理中，請稍候…'
                : order.status === 'PAID'
                  ? '付款成功'
                  : order.status === 'CANCELLED'
                    ? '訂單已取消，款項不會扣除'
                    : '—'}
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          to="/orders"
          className="flex h-11 items-center justify-center rounded-full bg-ink px-6 font-semibold text-white hover:opacity-90"
        >
          查看我的訂單
        </Link>
        <Link
          to="/products"
          className="flex h-11 items-center justify-center rounded-full border border-line px-6 text-ink hover:bg-paper-2"
        >
          繼續購物
        </Link>
      </div>
    </main>
  );
}
