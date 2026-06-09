import { useState } from 'react';
import { AxiosError } from 'axios';

import {
  useAdminCoupons,
  useCreateCoupon,
  useDeleteCoupon,
  type AdminCoupon,
} from '../../features/admin/useAdmin.js';
import { useAuthStore } from '../../stores/authStore.js';

export function AdminCouponsPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data, isLoading } = useAdminCoupons();
  const createCoupon = useCreateCoupon();
  const deleteCoupon = useDeleteCoupon();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState('');

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setCreateError('');

    const usageLimitRaw = fd.get('usageLimit') as string;
    const minAmountRaw = fd.get('minAmount') as string;

    createCoupon.mutate(
      {
        code: (fd.get('code') as string).toUpperCase(),
        type: fd.get('type') as 'FIXED' | 'PERCENT',
        value: fd.get('value') as string,
        minAmount: minAmountRaw || undefined,
        usageLimit: usageLimitRaw ? Number(usageLimitRaw) : undefined,
      },
      {
        onSuccess: () => {
          setShowCreateForm(false);
          setCreateError('');
        },
        onError: (err) => {
          const msg =
            err instanceof AxiosError
              ? ((err.response?.data as { error?: { message?: string } })?.error?.message ??
                '建立失敗')
              : '建立失敗';
          setCreateError(msg);
        },
      },
    );
  }

  function handleDelete(coupon: AdminCoupon) {
    if (!isSuperAdmin) {
      window.alert('僅限超級管理員刪除優惠券');
      return;
    }
    if (!window.confirm(`確定要刪除優惠券「${coupon.code}」？此操作無法復原。`)) return;
    deleteCoupon.mutate(coupon.id);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">優惠券管理</h1>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-lg bg-ink px-4 py-2 text-sm text-white hover:opacity-80"
        >
          {showCreateForm ? '取消' : '新增優惠券'}
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-lg border border-line bg-surface p-6 space-y-4"
        >
          <h2 className="font-semibold">新增優惠券</h2>
          {createError && <p className="text-sm text-red-500">{createError}</p>}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              代碼（大寫英數）
              <input
                name="code"
                required
                placeholder="SUMMER20"
                className="rounded border border-line px-3 py-2 text-sm uppercase"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              類型
              <select name="type" required className="rounded border border-line px-3 py-2 text-sm">
                <option value="FIXED">固定折扣</option>
                <option value="PERCENT">百分比折扣</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              折扣值（FIXED: 金額；PERCENT: %）
              <input
                name="value"
                required
                placeholder="0.00"
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              最低消費（選填）
              <input
                name="minAmount"
                placeholder="0.00"
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              使用上限（選填）
              <input
                name="usageLimit"
                type="number"
                min={1}
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={createCoupon.isPending}
            className="rounded-lg bg-ink px-6 py-2 text-sm text-white hover:opacity-80 disabled:opacity-50"
          >
            {createCoupon.isPending ? '建立中…' : '建立'}
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="text-ink-soft">載入中…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface">
              <tr>
                {['代碼', '類型', '折扣', '最低消費', '使用上限', '操作'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((c) => (
                <tr key={c.id} className="hover:bg-paper-2">
                  <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                  <td className="px-4 py-3">{c.type === 'FIXED' ? '固定' : '百分比'}</td>
                  <td className="px-4 py-3">
                    {c.type === 'FIXED' ? `NT$${c.value}` : `${c.value}%`}
                  </td>
                  <td className="px-4 py-3">{c.minAmount ? `NT$${c.minAmount}` : '—'}</td>
                  <td className="px-4 py-3">{c.usageLimit ?? '無限制'}</td>
                  <td className="px-4 py-3">
                    {isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        disabled={deleteCoupon.isPending}
                        className="rounded px-3 py-1 text-xs border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                    無優惠券資料
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
