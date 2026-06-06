import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SkuDto } from '@app/shared';

import { formatMoney } from '../features/products/format.js';
import { useProduct } from '../features/products/useProducts.js';
import { VariantPicker } from '../features/products/VariantPicker.js';

export function ProductDetailPage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const { data: product, isLoading, isError, error } = useProduct(slug);
  const [selectedSku, setSelectedSku] = useState<SkuDto | null>(null);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-ink-soft">Loading…</p>
      </main>
    );
  }
  if (isError) {
    // Distinguish 404 from generic load failure so the FE doesn't print a
    // scary error on a typo'd slug — useful when the URL was shared.
    const isNotFound =
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      (error as { response?: { status?: number } }).response?.status === 404;
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="font-display text-2xl font-bold mb-3">
          {isNotFound ? 'Product not found' : '載入失敗'}
        </h1>
        <Link to="/products" className="text-primary hover:text-primary-press">
          ← Back to all products
        </Link>
      </main>
    );
  }
  if (!product) return <main />;

  const displayPrice = selectedSku?.price ?? product.basePrice;
  const stock = selectedSku?.stock ?? 0;
  const outOfStock = selectedSku !== null && stock <= 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link
        to={`/products?category=${product.category.slug}`}
        className="mb-4 inline-block text-sm text-ink-soft hover:text-ink"
      >
        ← {product.category.name}
      </Link>

      <div className="grid gap-10 md:grid-cols-2">
        {/* Gallery */}
        <div className="flex flex-col gap-3">
          {product.images.map((img, idx) => (
            <div key={img.id} className="aspect-square overflow-hidden rounded-lg bg-paper-2">
              <img
                src={img.url}
                alt={img.alt ?? product.name}
                loading={idx === 0 ? 'eager' : 'lazy'}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="md:sticky md:top-24 self-start flex flex-col gap-6">
          <div>
            <h1 className="font-display text-3xl font-bold leading-tight">{product.name}</h1>
            <div className="mt-2 font-display text-2xl text-ink">{formatMoney(displayPrice)}</div>
          </div>
          <p className="text-ink-soft leading-relaxed">{product.description}</p>

          {product.variants.length > 0 ? (
            <VariantPicker product={product} onSkuChange={setSelectedSku} />
          ) : null}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={!selectedSku || outOfStock}
              className="h-12 rounded-full bg-primary px-6 font-semibold text-on-primary hover:bg-primary-press disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!selectedSku
                ? 'Select an option'
                : outOfStock
                  ? 'Out of stock'
                  : 'Add to cart — coming in Phase 3'}
            </button>
            {selectedSku && !outOfStock && (
              <p className="text-xs text-ink-soft">
                {stock} in stock · SKU {selectedSku.code}
              </p>
            )}
            {outOfStock && (
              <p role="alert" className="text-xs text-danger">
                This variant is currently out of stock.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
