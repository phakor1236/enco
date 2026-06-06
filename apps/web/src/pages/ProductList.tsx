import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ProductCard } from '../features/products/ProductCard.js';
import { useCategories, useInfiniteProducts } from '../features/products/useProducts.js';

export function ProductListPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const categorySlug = searchParams.get('category') ?? undefined;

  const { data: categories } = useCategories();
  const products = useInfiniteProducts({ categorySlug });

  const heading = useMemo(() => {
    if (!categorySlug) return 'All products';
    const match = categories?.find((c) => c.slug === categorySlug);
    return match?.name ?? categorySlug;
  }, [categorySlug, categories]);

  // IntersectionObserver-driven infinite scroll — sentinel sits at the bottom
  // of the grid; entering the viewport triggers fetchNextPage. The hasNext
  // guard prevents a flood of empty fetches once we've drained the cursor.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && products.hasNextPage && !products.isFetchingNextPage) {
          void products.fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [products]);

  const items = products.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold mb-6">{heading}</h1>

      {products.isLoading ? (
        <p className="text-ink-soft">Loading…</p>
      ) : products.isError ? (
        <p role="alert" className="text-danger">
          載入失敗,請稍後再試
        </p>
      ) : items.length === 0 ? (
        <p className="text-ink-soft">No products in this category yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-10" aria-hidden />
          {products.isFetchingNextPage && (
            <p className="mt-4 text-center text-sm text-ink-soft">Loading more…</p>
          )}
          {!products.hasNextPage && items.length > 0 && (
            <p className="mt-4 text-center text-sm text-ink-faint">— end —</p>
          )}
        </>
      )}
    </main>
  );
}
