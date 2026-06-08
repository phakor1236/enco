import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { CartItemDto } from '@app/shared';

import { useAuthStore } from '../../stores/authStore.js';
import { useCartUiStore } from '../../stores/cartUiStore.js';
import { formatMoney } from '../products/format.js';

import { useCart, useRemoveCartItem, useUpdateCartItem } from './useCart.js';

/**
 * Right-side slide-in cart panel. Reads from the same `useCart` query as the
 * header icon — so opening renders instantly from cache and falls back to a
 * spinner only on a true cold start.
 *
 * Checkout button is gated: guests see a "請先登入再結帳" link to /login;
 * members see a disabled "結帳" since the checkout flow ships in T4.
 */
export function CartDrawer(): JSX.Element | null {
  const open = useCartUiStore((s) => s.drawerOpen);
  const close = useCartUiStore((s) => s.closeDrawer);

  // Esc-to-close — keep the panel keyboard-dismissible per WCAG. The listener
  // is scoped to mount-while-open so we don't leak handlers on hot reload.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="購物車">
      <button
        type="button"
        aria-label="關閉購物車"
        onClick={close}
        className="absolute inset-0 bg-black/40"
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-surface shadow-xl">
        <DrawerHeader onClose={close} />
        <DrawerBody />
        <DrawerFooter />
      </aside>
    </div>
  );
}

function DrawerHeader({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <header className="flex items-center justify-between border-b border-line px-5 py-4">
      <h2 className="font-display text-lg font-bold">購物車</h2>
      <button
        type="button"
        onClick={onClose}
        className="rounded-full px-2 py-1 text-ink-soft hover:bg-paper-2 hover:text-ink"
        aria-label="關閉"
      >
        ✕
      </button>
    </header>
  );
}

function DrawerBody(): JSX.Element {
  const { data: cart, isLoading, isError } = useCart();

  if (isLoading) {
    return <p className="px-5 py-10 text-center text-ink-soft">載入中…</p>;
  }
  if (isError || !cart) {
    return (
      <p role="alert" className="px-5 py-10 text-center text-danger">
        購物車載入失敗，請重新整理
      </p>
    );
  }
  if (cart.items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-ink-soft">
        <p>購物車是空的</p>
        <Link to="/products" className="text-primary hover:text-primary-press">
          去逛逛 →
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex-1 divide-y divide-line overflow-y-auto">
      {cart.items.map((item) => (
        <CartLine key={item.id} item={item} />
      ))}
    </ul>
  );
}

function CartLine({ item }: { item: CartItemDto }): JSX.Element {
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const isLastOne = item.qty <= 1;
  const reachedStock = item.qty >= item.stock;
  const optionsLabel = Object.entries(item.optionCombination)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');

  return (
    <li className="flex gap-3 px-5 py-4">
      {item.product.primaryImage ? (
        <img
          src={item.product.primaryImage.url}
          alt={item.product.primaryImage.alt ?? item.product.name}
          className="h-16 w-16 flex-none rounded-md object-cover"
        />
      ) : (
        <div aria-hidden="true" className="h-16 w-16 flex-none rounded-md bg-paper-2" />
      )}
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex justify-between gap-2">
          <Link
            to={`/product/${item.product.slug}`}
            className="line-clamp-2 text-sm font-medium hover:text-primary"
          >
            {item.product.name}
          </Link>
          <span className="text-sm font-semibold tabular-nums">{formatMoney(item.lineTotal)}</span>
        </div>
        {optionsLabel && <p className="text-xs text-ink-soft">{optionsLabel}</p>}
        <div className="mt-1 flex items-center justify-between">
          <div className="inline-flex items-center rounded-full border border-line">
            <QtyButton
              label="減少數量"
              symbol="−"
              disabled={isLastOne || update.isPending}
              onClick={() => update.mutate({ itemId: item.id, qty: item.qty - 1 })}
            />
            <span className="min-w-[2rem] px-2 text-center text-sm tabular-nums">{item.qty}</span>
            <QtyButton
              label="增加數量"
              symbol="+"
              disabled={reachedStock || update.isPending}
              onClick={() => update.mutate({ itemId: item.id, qty: item.qty + 1 })}
            />
          </div>
          <button
            type="button"
            onClick={() => remove.mutate({ itemId: item.id })}
            disabled={remove.isPending}
            className="text-xs text-ink-soft underline-offset-2 hover:text-danger hover:underline disabled:opacity-50"
          >
            移除
          </button>
        </div>
      </div>
    </li>
  );
}

function QtyButton({
  label,
  symbol,
  disabled,
  onClick,
}: {
  label: string;
  symbol: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 text-base leading-none hover:bg-paper-2 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {symbol}
    </button>
  );
}

function DrawerFooter(): JSX.Element | null {
  const { data: cart } = useCart();
  const user = useAuthStore((s) => s.user);
  const close = useCartUiStore((s) => s.closeDrawer);
  if (!cart || cart.items.length === 0) return null;

  return (
    <footer className="border-t border-line px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm text-ink-soft">小計</span>
        <span className="font-display text-lg font-bold tabular-nums">
          {formatMoney(cart.subtotal)}
        </span>
      </div>
      {user ? (
        // T4 will swap this for a real /checkout link. Disabled-but-honest is
        // preferable to a button that 404s the user.
        <button
          type="button"
          disabled
          className="h-11 w-full rounded-full bg-ink font-semibold text-white opacity-50 cursor-not-allowed"
        >
          結帳（即將上線）
        </button>
      ) : (
        <Link
          to="/login"
          onClick={close}
          className="flex h-11 w-full items-center justify-center rounded-full bg-ink font-semibold text-white hover:opacity-90"
        >
          請先登入再結帳
        </Link>
      )}
    </footer>
  );
}
