import { useState } from 'react';

import {
  useAdminProducts,
  useCreateProduct,
  useUpdateProduct,
  useArchiveProduct,
  type AdminProduct,
} from '../../features/admin/useAdmin.js';
import { extractApiError } from '../../lib/apiError.js';

export function AdminProductsPage(): JSX.Element {
  const { data, isLoading } = useAdminProducts();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const archiveProduct = useArchiveProduct();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createError, setCreateError] = useState('');

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setCreateError('');
    createProduct.mutate(
      {
        name: fd.get('name') as string,
        slug: fd.get('slug') as string,
        categoryId: fd.get('categoryId') as string,
        basePrice: fd.get('basePrice') as string,
        description: fd.get('description') as string,
        status: 'ACTIVE',
      },
      {
        onSuccess: () => setShowCreateForm(false),
        onError: (err) => {
          setCreateError(extractApiError(err, '建立失敗'));
        },
      },
    );
  }

  function handleStatusToggle(product: AdminProduct) {
    const newStatus = product.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';
    updateProduct.mutate({ id: product.id, data: { status: newStatus } });
  }

  function handleArchive(product: AdminProduct) {
    if (!window.confirm(`確定要封存「${product.name}」？`)) return;
    archiveProduct.mutate(product.id);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">商品管理</h1>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="rounded-lg bg-ink px-4 py-2 text-sm text-white hover:opacity-80"
        >
          {showCreateForm ? '取消' : '新增商品'}
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-lg border border-line bg-surface p-6 space-y-4"
        >
          <h2 className="font-semibold">新增商品</h2>
          {createError && <p className="text-sm text-red-500">{createError}</p>}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              商品名稱
              <input
                name="name"
                required
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Slug（英文）
              <input
                name="slug"
                required
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              分類 ID
              <input
                name="categoryId"
                required
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              基礎售價
              <input
                name="basePrice"
                required
                placeholder="0.00"
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">
              描述（選填）
              <textarea
                name="description"
                rows={3}
                className="rounded border border-line px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={createProduct.isPending}
            className="rounded-lg bg-ink px-6 py-2 text-sm text-white hover:opacity-80 disabled:opacity-50"
          >
            {createProduct.isPending ? '建立中…' : '建立'}
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
                {['商品名稱', 'Slug', '狀態', '基礎售價', '操作'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((p) => (
                <tr key={p.id} className="hover:bg-paper-2">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-soft">{p.slug}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-700'
                          : p.status === 'ARCHIVED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {p.status === 'ACTIVE' ? '上架' : p.status === 'ARCHIVED' ? '已封存' : '草稿'}
                    </span>
                  </td>
                  <td className="px-4 py-3">NT${p.basePrice}</td>
                  <td className="px-4 py-3">
                    {p.status !== 'ARCHIVED' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleStatusToggle(p)}
                          className="rounded px-3 py-1 text-xs border border-line hover:bg-paper-2"
                        >
                          {p.status === 'ACTIVE' ? '下架' : '上架'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchive(p)}
                          className="rounded px-3 py-1 text-xs border border-red-300 text-red-600 hover:bg-red-50"
                        >
                          封存
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                    無商品資料
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
