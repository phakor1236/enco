import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProductDetailDto, SkuDto } from '@app/shared';

import { VariantPicker } from '../../src/features/products/VariantPicker.js';

function buildSingleAxisProduct(overrides: Partial<ProductDetailDto> = {}): ProductDetailDto {
  return {
    id: 'p1',
    slug: 'tee',
    name: 'Tee',
    description: '',
    basePrice: '29.00',
    status: 'ACTIVE',
    category: { id: 'c1', name: 'Apparel', slug: 'apparel' },
    images: [],
    variants: [
      {
        id: 'v1',
        name: 'Size',
        options: [
          { id: 'o-s', value: 'S', sort: 0 },
          { id: 'o-m', value: 'M', sort: 1 },
          { id: 'o-l', value: 'L', sort: 2 },
        ],
      },
    ],
    skus: [
      sku('sku-s', 'TEE-S', '29.00', 10, { Size: 'S' }),
      sku('sku-m', 'TEE-M', '29.00', 5, { Size: 'M' }),
      // L has NO active SKU — review I1 case
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function sku(
  id: string,
  code: string,
  price: string,
  stock: number,
  optionCombination: Record<string, string>,
): SkuDto {
  return { id, code, price, stock, optionCombination, status: 'ACTIVE' };
}

describe('<VariantPicker />', () => {
  it('selects the first SKU-backed option on mount and reports it', () => {
    const onChange = vi.fn();
    render(<VariantPicker product={buildSingleAxisProduct()} onSkuChange={onChange} />);

    // S is the first option with an ACTIVE SKU; should be pre-selected.
    const sBtn = screen.getByRole('button', { name: /Size: S/ });
    expect(sBtn).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ code: 'TEE-S', stock: 10 }),
    );
  });

  it('switching options reports the new SKU (price + stock update path)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VariantPicker product={buildSingleAxisProduct()} onSkuChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Size: M/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'TEE-M', stock: 5 }));
  });

  it('disables options whose only SKU is ARCHIVED (review T2.3 I1)', () => {
    render(<VariantPicker product={buildSingleAxisProduct()} />);
    // "L" exists as an option but has no ACTIVE SKU in the input.
    const lBtn = screen.getByRole('button', { name: /Size: L \(缺貨\)/ });
    expect(lBtn).toBeDisabled();
  });

  it('multi-axis: disables Color×Size pairs the user cannot complete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const product: ProductDetailDto = {
      ...buildSingleAxisProduct(),
      variants: [
        {
          id: 'v1',
          name: 'Color',
          options: [
            { id: 'red', value: 'Red', sort: 0 },
            { id: 'blue', value: 'Blue', sort: 1 },
          ],
        },
        {
          id: 'v2',
          name: 'Size',
          options: [
            { id: 's', value: 'S', sort: 0 },
            { id: 'm', value: 'M', sort: 1 },
          ],
        },
      ],
      skus: [
        sku('a', 'RED-S', '29.00', 4, { Color: 'Red', Size: 'S' }),
        sku('b', 'RED-M', '29.00', 2, { Color: 'Red', Size: 'M' }),
        sku('c', 'BLUE-S', '29.00', 7, { Color: 'Blue', Size: 'S' }),
        // No Blue × M SKU exists
      ],
    };
    render(<VariantPicker product={product} onSkuChange={onChange} />);

    // Default selection should be Red + S.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'RED-S' }));

    await user.click(screen.getByRole('button', { name: /Color: Blue/ }));
    // After selecting Blue, M should be disabled because no Blue × M SKU exists.
    const mBtn = screen.getByRole('button', { name: /Size: M/ });
    expect(mBtn).toBeDisabled();
  });
});
