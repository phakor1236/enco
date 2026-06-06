import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';

const app = createApp();

// ============================================================================
// Fixtures — these tests assume the catalog seed has been run on the test DB.
// globalSetup (tests/helpers/setup.ts) applies migrations but does NOT seed,
// so we apply the seed inline once per file (idempotent → safe to repeat).
// ============================================================================

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ============================================================================
// GET /api/categories
// ============================================================================

describe('GET /api/categories', () => {
  it('returns all categories sorted by name', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(5);

    const names = res.body.items.map((c: { name: string }) => c.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);

    for (const c of res.body.items) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.slug).toBe('string');
      expect(c.parentId === null || typeof c.parentId === 'string').toBe(true);
    }
  });
});

// ============================================================================
// GET /api/products
// ============================================================================

describe('GET /api/products', () => {
  it('returns paginated ACTIVE products with a primary image and category ref', async () => {
    const res = await request(app).get('/api/products').query({ limit: 12 });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(12);
    expect(typeof res.body.nextCursor).toBe('string');

    const item = res.body.items[0];
    expect(item).toMatchObject({
      id: expect.any(String),
      slug: expect.any(String),
      name: expect.any(String),
      basePrice: expect.stringMatching(/^\d+\.\d{2}$/),
      status: 'ACTIVE',
      category: { id: expect.any(String), name: expect.any(String), slug: expect.any(String) },
    });
    expect(item.primaryImage).toMatchObject({
      url: expect.any(String),
      sort: expect.any(Number),
    });
  });

  it('filters by categorySlug', async () => {
    const res = await request(app)
      .get('/api/products')
      .query({ categorySlug: 'footwear', limit: 50 });
    expect(res.status).toBe(200);
    // Seed puts 6 footwear products in.
    expect(res.body.items.length).toBe(6);
    for (const p of res.body.items) {
      expect(p.category.slug).toBe('footwear');
    }
    expect(res.body.nextCursor).toBeNull();
  });

  it('paginates with cursor — next page is contiguous and disjoint from first page', async () => {
    const first = await request(app).get('/api/products').query({ limit: 10 });
    expect(first.status).toBe(200);
    expect(first.body.items.length).toBe(10);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app)
      .get('/api/products')
      .query({ limit: 10, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(second.body.items.length).toBe(10);

    const firstIds = new Set(first.body.items.map((p: { id: string }) => p.id));
    for (const p of second.body.items) {
      expect(firstIds.has(p.id)).toBe(false);
    }
  });

  it('returns an empty page (not 500) when cursor refers to a missing product', async () => {
    // Prisma compiles the cursor as a correlated subquery against the
    // missing id → NULL comparisons → empty result. Captures the behavior
    // so a future Prisma upgrade that changes this surfaces in CI.
    const res = await request(app)
      .get('/api/products')
      .query({ cursor: 'cl0deletedrowxxxxxxxxx00', limit: 10 });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it('rejects invalid query (limit out of range) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/api/products').query({ limit: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('does NOT surface DRAFT or ARCHIVED products', async () => {
    // Flip one seed product to DRAFT, ensure it disappears, then revert.
    const target = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true, status: true },
    });
    await prisma.product.update({ where: { id: target.id }, data: { status: 'DRAFT' } });
    try {
      const res = await request(app)
        .get('/api/products')
        .query({ categorySlug: undefined, limit: 50 });
      const slugs: string[] = res.body.items.map((p: { slug: string }) => p.slug);
      expect(slugs).not.toContain(target.slug);
    } finally {
      await prisma.product.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
    }
  });
});

// ============================================================================
// GET /api/products/:slug
// ============================================================================

describe('GET /api/products/:slug', () => {
  it('returns full detail with variants, options, SKUs, images', async () => {
    const res = await request(app).get('/api/products/classic-crew-tee');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'classic-crew-tee',
      status: 'ACTIVE',
      basePrice: expect.stringMatching(/^\d+\.\d{2}$/),
      category: { slug: 'apparel' },
    });
    expect(res.body.images.length).toBeGreaterThan(0);
    expect(res.body.variants).toHaveLength(1);
    expect(res.body.variants[0].name).toBe('Size');
    // Options must be sorted ascending by `sort`.
    const sorts = res.body.variants[0].options.map((o: { sort: number }) => o.sort);
    expect(sorts).toEqual([...sorts].sort((a: number, b: number) => a - b));
    // Each option has a corresponding ACTIVE SKU.
    expect(res.body.skus.length).toBe(res.body.variants[0].options.length);
    for (const sku of res.body.skus) {
      expect(sku.status).toBe('ACTIVE');
      expect(sku.price).toMatch(/^\d+\.\d{2}$/);
      expect(sku.optionCombination).toHaveProperty('Size');
    }
  });

  it('returns 404 PRODUCT_NOT_FOUND for an unknown slug', async () => {
    const res = await request(app).get('/api/products/nonexistent-slug-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('returns 404 when the product exists but is DRAFT', async () => {
    const target = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      select: { id: true, slug: true },
    });
    await prisma.product.update({ where: { id: target.id }, data: { status: 'DRAFT' } });
    try {
      const res = await request(app).get(`/api/products/${target.slug}`);
      expect(res.status).toBe(404);
    } finally {
      await prisma.product.update({ where: { id: target.id }, data: { status: 'ACTIVE' } });
    }
  });
});

// ============================================================================
// N+1 defense — list endpoint must emit exactly ONE SQL query.
//
// `$on('query')` requires the client be constructed with event-style logging.
// The shared `prisma` singleton uses stdout logging only, so we spin up a
// throwaway client with event emission and inject it via the service's
// `db?` parameter (same pattern authService uses for tx-friendliness). The
// test thus exercises the real listProducts code path with a live DB.
// ============================================================================

describe('GET /api/products — N+1 guard (plan T2.3 acceptance)', () => {
  it('emits exactly one SQL query for a 12-item page', async () => {
    const tracer = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    const queries: string[] = [];
    tracer.$on('query' as never, (e: { query: string }) => {
      // Filter to actual catalog SELECTs — Prisma also emits SET, BEGIN,
      // deallocate, and warm-up pings as query events.
      if (/^SELECT/i.test(e.query) && /"products"|"categories"|"product_images"/.test(e.query)) {
        queries.push(e.query);
      }
    });

    const { listProducts } = await import('../../src/services/productService.js');
    try {
      await listProducts({ limit: 12 }, tracer);
    } finally {
      await tracer.$disconnect();
    }

    expect(queries).toHaveLength(1);
    // Sanity: the single query is a LATERAL JOIN across the three tables.
    expect(queries[0]).toMatch(/LEFT JOIN/i);
    expect(queries[0]).toMatch(/"categories"/);
    expect(queries[0]).toMatch(/"product_images"/);
  });
});
