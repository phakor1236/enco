import { Link } from 'react-router-dom';

import { ProductCard } from '../features/products/ProductCard.js';
import { useInfiniteProducts } from '../features/products/useProducts.js';

const HOME_LIMIT = 8;

export function HomePage(): JSX.Element {
  const products = useInfiniteProducts({ limit: HOME_LIMIT });
  const items = products.data?.pages[0]?.items ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <section className="mb-10 rounded-2xl bg-ink text-white px-10 py-16">
        <p className="mb-2 text-xs uppercase tracking-widest text-white/60">New Season</p>
        <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">
          Made for the long way home.
        </h1>
        <p className="max-w-prose text-white/80 mb-6">
          Considered everyday goods — apparel, footwear, and small objects you'll keep for years.
        </p>
        <Link
          to="/products"
          className="inline-flex rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-press"
        >
          Shop everything
        </Link>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold">Just in</h2>
          <Link to="/products" className="text-sm text-primary hover:text-primary-press">
            View all →
          </Link>
        </div>
        {products.isLoading ? (
          <p className="text-ink-soft">Loading…</p>
        ) : products.isError ? (
          <p role="alert" className="text-danger">
            載入失敗,請稍後再試
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
