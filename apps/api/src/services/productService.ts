import type { Prisma, PrismaClient } from '@prisma/client';
import { ProductStatus } from '@prisma/client';
import type {
  CategoryDto,
  ProductDetailDto,
  ProductListItemDto,
  ProductListResponse,
} from '@app/shared';

import { prisma } from '../lib/db.js';

/**
 * Service-layer client handle. Accepting either a base PrismaClient or a
 * TransactionClient mirrors authService.DbClient — keeps these functions
 * usable inside a Phase 4 checkout `prisma.$transaction(...)` and makes
 * tests injectable (the N+1 guard test below relies on this to swap in
 * an event-logging client).
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

// Storefront endpoints only ever surface ACTIVE products. DRAFT is admin-only
// (T6.3 will reuse the schema with a wider filter); ARCHIVED is for orphan
// historical references via OrderItem snapshots, never live retrieval.
const STOREFRONT_STATUS: ProductStatus = ProductStatus.ACTIVE;

export interface ListProductsOpts {
  categorySlug?: string;
  limit: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Mappers — convert Prisma rows to over-the-wire DTOs. Decimal → string is
// the load-bearing transform: Prisma's Decimal.js objects round-trip through
// JSON as their internal shape, not "29.00", and would break FE consumers.
// ---------------------------------------------------------------------------

type ProductListRow = Prisma.ProductGetPayload<{
  include: {
    category: { select: { id: true; name: true; slug: true } };
    images: { orderBy: { sort: 'asc' }; take: 1 };
  };
}>;

type ProductDetailRow = Prisma.ProductGetPayload<{
  include: {
    category: { select: { id: true; name: true; slug: true } };
    images: { orderBy: { sort: 'asc' } };
    variants: {
      include: { options: { orderBy: { sort: 'asc' } } };
      orderBy: { createdAt: 'asc' };
    };
    skus: { orderBy: { createdAt: 'asc' } };
  };
}>;

function toListDto(p: ProductListRow): ProductListItemDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    basePrice: p.basePrice.toFixed(2),
    status: p.status,
    category: p.category,
    primaryImage: p.images[0]
      ? {
          id: p.images[0].id,
          url: p.images[0].url,
          alt: p.images[0].alt,
          sort: p.images[0].sort,
        }
      : null,
    createdAt: p.createdAt.toISOString(),
  };
}

function toDetailDto(p: ProductDetailRow): ProductDetailDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    basePrice: p.basePrice.toFixed(2),
    status: p.status,
    category: p.category,
    images: p.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, sort: i.sort })),
    variants: p.variants.map((v) => ({
      id: v.id,
      name: v.name,
      options: v.options.map((o) => ({ id: o.id, value: o.value, sort: o.sort })),
    })),
    skus: p.skus.map((s) => ({
      id: s.id,
      code: s.code,
      price: s.price.toFixed(2),
      stock: s.stock,
      // optionCombination is stored as JSONB with arbitrary string values;
      // narrow to Record<string, string> for the DTO contract.
      optionCombination: s.optionCombination as Record<string, string>,
      status: s.status,
    })),
    createdAt: p.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(db: DbClient = prisma): Promise<CategoryDto[]> {
  const rows = await db.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, parentId: true },
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function listProducts(
  opts: ListProductsOpts,
  db: DbClient = prisma,
): Promise<ProductListResponse> {
  const { categorySlug, limit, cursor } = opts;

  const where: Prisma.ProductWhereInput = {
    status: STOREFRONT_STATUS,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
  };

  // `relationLoadStrategy: 'join'` collapses the parent + included relations
  // into a single LEFT JOIN — keeps the query count at 1 even with nested
  // include + take (the T2.3 N+1 guard test asserts this).
  //
  // Compound ordering (createdAt, id) breaks the cursor tie when seed runs
  // create multiple rows in the same millisecond — without it, paging skips
  // rows on the boundary.
  const rows = (await db.product.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      category: { select: { id: true, name: true, slug: true } },
      images: { orderBy: { sort: 'asc' }, take: 1 },
    },
    relationLoadStrategy: 'join',
  })) as ProductListRow[];

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const overflow = rows.pop();
    nextCursor = overflow?.id ?? null;
  }

  return {
    items: rows.map(toListDto),
    nextCursor,
  };
}

export async function getProductBySlug(
  slug: string,
  db: DbClient = prisma,
): Promise<ProductDetailDto | null> {
  const row = (await db.product.findUnique({
    where: { slug },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      images: { orderBy: { sort: 'asc' } },
      variants: {
        include: { options: { orderBy: { sort: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      },
      // Only ACTIVE SKUs reach storefront — ARCHIVED stay accessible to
      // OrderItem snapshot lookups (Phase 4) but never the picker.
      skus: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } },
    },
    relationLoadStrategy: 'join',
  })) as ProductDetailRow | null;

  if (!row || row.status !== STOREFRONT_STATUS) return null;
  return toDetailDto(row);
}
