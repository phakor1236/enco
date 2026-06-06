import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CategoryDto, ProductDetailDto, ProductListResponse } from '@app/shared';

import { apiClient } from '../../lib/apiClient.js';

/**
 * React Query keys live here so caches stay invalidatable from anywhere.
 * Tuple form makes them easy to match with `queryClient.invalidateQueries`.
 */
export const productKeys = {
  categories: () => ['categories'] as const,
  list: (categorySlug?: string, limit?: number) =>
    ['products', 'list', { categorySlug, limit }] as const,
  detail: (slug: string) => ['products', 'detail', slug] as const,
};

const DEFAULT_PAGE_SIZE = 12;

export function useCategories(): UseQueryResult<CategoryDto[]> {
  return useQuery({
    queryKey: productKeys.categories(),
    staleTime: 5 * 60_000, // categories rarely change
    queryFn: async () => {
      const res = await apiClient.get<{ items: CategoryDto[] }>('/categories');
      return res.data.items;
    },
  });
}

/**
 * Infinite list backed by /api/products cursor pagination. ScrollLoader (see
 * ProductList page) consumes `fetchNextPage` via an IntersectionObserver on a
 * sentinel <div>.
 */
export function useInfiniteProducts(opts: {
  categorySlug?: string;
  limit?: number;
}): UseInfiniteQueryResult<{ pages: ProductListResponse[]; pageParams: (string | null)[] }> {
  const { categorySlug, limit = DEFAULT_PAGE_SIZE } = opts;
  return useInfiniteQuery({
    queryKey: productKeys.list(categorySlug, limit),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: String(limit) };
      if (categorySlug) params.categorySlug = categorySlug;
      if (pageParam) params.cursor = pageParam;
      const res = await apiClient.get<ProductListResponse>('/products', { params });
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useProduct(slug: string | undefined): UseQueryResult<ProductDetailDto> {
  return useQuery({
    queryKey: productKeys.detail(slug ?? ''),
    enabled: Boolean(slug),
    queryFn: async () => {
      const res = await apiClient.get<ProductDetailDto>(`/products/${encodeURIComponent(slug!)}`);
      return res.data;
    },
  });
}
