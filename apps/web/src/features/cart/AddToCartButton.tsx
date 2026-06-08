import type { SkuDto } from '@app/shared';

import { useAddCartItem } from './useCart.js';

interface Props {
  selectedSku: SkuDto | null;
  /** True when the product has any variants — disables the button until the
   *  user picks one so they don't accidentally add a fallback SKU. */
  requiresVariantPick: boolean;
}

/**
 * Renders the primary CTA on the product detail page. Shows three states
 * depending on whether the user has picked a SKU and whether stock allows it.
 */
export function AddToCartButton({ selectedSku, requiresVariantPick }: Props): JSX.Element {
  const add = useAddCartItem();

  const stock = selectedSku?.stock ?? 0;
  const outOfStock = selectedSku !== null && stock <= 0;
  const needsPick = !selectedSku;
  // Always require a selectedSku — the no-variant case will pick up the
  // single SKU once ProductDetail auto-selects it; until then, an enabled
  // button whose click handler bails would look broken to the user.
  const disabled = needsPick || outOfStock || add.isPending;

  let label = '加入購物車';
  if (needsPick) label = requiresVariantPick ? '請選擇規格' : '無可購買的規格';
  else if (outOfStock) label = '缺貨中';
  else if (add.isPending) label = '加入中…';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!selectedSku) return;
        add.mutate({ skuId: selectedSku.id, qty: 1 });
      }}
      className="h-12 rounded-full bg-primary px-6 font-semibold text-on-primary hover:bg-primary-press disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
