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
    if (!categorySlug) return '所有商品';
    const match = categories?.find((c) => c.slug === categorySlug);
    return match?.name ?? categorySlug;
  }, [categorySlug, categories]);

  // IntersectionObserver-driven infinite scroll — sentinel sits at the bottom
  // of the grid; entering the viewport triggers fetchNextPage. The hasNext
  // guard prevents a flood of empty fetches once we've drained the cursor.
  //
  // Depend on the specific stable values rather than the whole `products`
  // result (which gets a new identity on every state tick) — avoids
  // tearing down + re-attaching the observer dozens of times per fetch
  // cycle (review I3).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = products;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = products.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold mb-6">{heading}</h1>

      {products.isLoading ? (
        <p className="text-ink-soft">載入中…</p>
      ) : products.isError ? (
        <p role="alert" className="text-danger">
          載入失敗,請稍後再試
        </p>
      ) : items.length === 0 ? (
        <p className="text-ink-soft">此分類目前沒有商品</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-10" aria-hidden />
          {products.isFetchingNextPage && (
            <p className="mt-4 text-center text-sm text-ink-soft">載入更多中…</p>
          )}
          {!products.hasNextPage && items.length > 0 && (
            <p className="mt-4 text-center text-sm text-ink-faint">— 已到結尾 —</p>
          )}
        </>
      )}
    </main>
  );
}
