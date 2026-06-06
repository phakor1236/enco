/**
 * Storefront-wide money formatting. Server returns Decimal as a "29.00" string
 * so the only thing we do FE-side is currency display. Single source so the
 * Cart / Checkout slices reuse it.
 */
const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatMoney(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return moneyFormatter.format(n);
}
