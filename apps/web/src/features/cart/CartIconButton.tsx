import { useCartUiStore } from '../../stores/cartUiStore.js';

import { useCart } from './useCart.js';

/**
 * Header cart trigger. Shows the current item count as a badge when > 0.
 * Reuses the same useCart query the drawer feeds off, so opening the drawer
 * is instant (data is already in cache).
 */
export function CartIconButton(): JSX.Element {
  const openDrawer = useCartUiStore((s) => s.openDrawer);
  const { data: cart } = useCart();
  const count = cart?.itemCount ?? 0;

  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label={count > 0 ? `購物車（${count} 件）` : '購物車'}
      className="relative rounded-full px-3 py-1.5 hover:bg-paper-2"
    >
      <CartIcon />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none text-on-primary"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

function CartIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </svg>
  );
}
