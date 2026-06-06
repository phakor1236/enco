import { useEffect, useMemo, useState } from 'react';
import type { ProductDetailDto, SkuDto } from '@app/shared';

import { cn } from '../../lib/cn.js';

interface VariantPickerProps {
  product: ProductDetailDto;
  onSkuChange?: (sku: SkuDto | null) => void;
}

type Selection = Record<string, string>;

/**
 * Picker for a product with N variant axes (Color, Size, …). Returns the
 * matching ACTIVE SKU once every axis has a selection.
 *
 * Review note T2.3 I1 — VariantOption rows exist even when their backing
 * SKU is ARCHIVED (server filters SKUs to ACTIVE but leaves option rows
 * intact). For each option we check "is there any ACTIVE SKU consistent
 * with the *other* currently-selected axes that includes this option?" and
 * disable when not. Disabling depends on the current selection: picking
 * "Red" may reveal that "XL" has no ACTIVE SKU paired with red, even when
 * "XL" appears valid in isolation.
 */
export function VariantPicker({ product, onSkuChange }: VariantPickerProps): JSX.Element {
  // Seed initial selection with each variant's first option that has a SKU.
  // Falls back to the first option even if archived — picker will indicate
  // "out of stock" via the resolved SKU state.
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product));

  const selectedSku = useMemo(() => resolveSku(product, selection), [product, selection]);

  useEffect(() => {
    onSkuChange?.(selectedSku);
  }, [selectedSku, onSkuChange]);

  return (
    <div className="flex flex-col gap-5">
      {product.variants.map((variant) => (
        <div key={variant.id}>
          <div className="mb-2 text-sm font-semibold text-ink-soft">
            {variant.name}
            <span className="ml-2 font-normal text-ink-faint">
              {selection[variant.name] ?? '—'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {variant.options.map((option) => {
              const available = isOptionAvailable(
                product.skus,
                product.variants,
                variant.name,
                option.value,
                selection,
              );
              const isSelected = selection[variant.name] === option.value;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!available}
                  onClick={() =>
                    setSelection((prev) => ({ ...prev, [variant.name]: option.value }))
                  }
                  className={cn(
                    'min-w-12 px-4 h-10 rounded-full border text-sm font-medium transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                    isSelected
                      ? 'border-ink bg-ink text-white'
                      : 'border-line bg-surface text-ink hover:bg-paper-2',
                    !available && 'opacity-40 line-through cursor-not-allowed hover:bg-surface',
                  )}
                  aria-pressed={isSelected}
                  aria-label={`${variant.name}: ${option.value}${available ? '' : ' (缺貨)'}`}
                >
                  {option.value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function initialSelection(product: ProductDetailDto): Selection {
  const out: Selection = {};
  for (const v of product.variants) {
    // Prefer the first option that's backed by an ACTIVE SKU; fall back to
    // the first option so the UI isn't blank when everything's archived.
    const backed = v.options.find((o) =>
      product.skus.some((s) => s.optionCombination[v.name] === o.value),
    );
    out[v.name] = (backed ?? v.options[0])?.value ?? '';
  }
  return out;
}

function resolveSku(product: ProductDetailDto, selection: Selection): SkuDto | null {
  if (product.variants.some((v) => !selection[v.name])) return null;
  return (
    product.skus.find((s) =>
      product.variants.every((v) => s.optionCombination[v.name] === selection[v.name]),
    ) ?? null
  );
}

function isOptionAvailable(
  skus: SkuDto[],
  variants: ProductDetailDto['variants'],
  axisName: string,
  optionValue: string,
  selection: Selection,
): boolean {
  // Project the prospective selection (replace the axis we're testing) and
  // check whether any ACTIVE SKU is consistent with it.
  return skus.some((s) => {
    if (s.optionCombination[axisName] !== optionValue) return false;
    return variants.every((v) => {
      if (v.name === axisName) return true;
      const chosen = selection[v.name];
      if (!chosen) return true;
      return s.optionCombination[v.name] === chosen;
    });
  });
}
