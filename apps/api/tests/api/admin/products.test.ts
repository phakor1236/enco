import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../../src/app.js';
import { prisma } from '../../../src/lib/db.js';
import { issueAccessToken } from '../../../src/services/authService.js';

/**
 * T6.3 acceptance:
 *   - POST /api/admin/products → 201 + AdminActionLog written
 *   - PATCH /api/admin/products/:id → 200 + AdminActionLog written
 *   - DELETE /api/admin/products/:id → 204 (archive) + AdminActionLog written
 *   - POST /api/admin/skus/:id/adjust-stock → 200 + AdminActionLog written
 *   - Non-admin → 403 FORBIDDEN
 *   - Demo account → 403 DEMO_ACCOUNT_READONLY
 */

const app = createApp();

const EMAIL_DOMAIN = 'admin-products-test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SLUG_PREFIX = 't63-test-';

let adminId: string;
let adminToken: string;
let demoAdminToken: string;
let customerToken: string;
let categoryId: string;

beforeAll(async () => {
  const { seedCatalog } = await import('../../../prisma/seed/products.js');
  await seedCatalog();

  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  categoryId = category.id;

  const admin = await prisma.user.upsert({
    where: { email: `admin@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `admin@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'ADMIN' },
  });
  adminId = admin.id;
  adminToken = issueAccessToken({ id: admin.id, role: admin.role });

  const demoAdmin = await prisma.user.upsert({
    where: { email: `demo-admin@${EMAIL_DOMAIN}` },
    update: {},
    create: {
      email: `demo-admin@${EMAIL_DOMAIN}`,
      passwordHash: DUMMY_HASH,
      role: 'ADMIN',
      isDemoReadonly: true,
    },
  });
  demoAdminToken = issueAccessToken({ id: demoAdmin.id, role: demoAdmin.role });

  const customer = await prisma.user.upsert({
    where: { email: `customer@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `customer@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  customerToken = issueAccessToken({ id: customer.id, role: customer.role });
});

afterAll(async () => {
  const products = await prisma.product.findMany({
    where: { slug: { startsWith: SLUG_PREFIX } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  // Delete child rows first (FK constraints prevent product deletion otherwise).
  await prisma.sku.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.adminActionLog.deleteMany({ where: { actorId: adminId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

// ── Auth gates ────────────────────────────────────────────────────────────────

describe('auth gates', () => {
  it('customer (CUSTOMER role) → 403 on POST /api/admin/products', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ name: 'x', slug: 'x', categoryId, basePrice: '10.00' });
    expect(res.status).toBe(403);
  });

  it('demo admin → 403 DEMO_ACCOUNT_READONLY on write', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${demoAdminToken}`)
      .send({ name: 'Demo', slug: `${SLUG_PREFIX}demo`, categoryId, basePrice: '10.00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEMO_ACCOUNT_READONLY');
  });

  it('unauthenticated → 401 on GET /api/admin/products', async () => {
    const res = await request(app).get('/api/admin/products');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/admin/products ───────────────────────────────────────────────────

describe('GET /api/admin/products', () => {
  it('returns paginated list including all statuses', async () => {
    const res = await request(app)
      .get('/api/admin/products?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect('nextCursor' in res.body).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/admin/products?status=DRAFT')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items as { status: string }[]) {
      expect(item.status).toBe('DRAFT');
    }
  });
});

// ── POST /api/admin/products ──────────────────────────────────────────────────

describe('POST /api/admin/products', () => {
  it('creates product + writes AdminActionLog', async () => {
    const slug = `${SLUG_PREFIX}create-${Date.now()}`;
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'T6.3 Tee', slug, categoryId, basePrice: '299.00', status: 'DRAFT' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toBe(slug);

    const log = await prisma.adminActionLog.findFirst({
      where: {
        actorId: adminId,
        resourceType: 'product',
        resourceId: res.body.id,
        action: 'create',
      },
    });
    expect(log).not.toBeNull();
    expect((log!.diff as Record<string, unknown>)['slug']).toBe(slug);
  });

  it('400 on invalid body (slug with uppercase)', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad', slug: 'UPPERCASE', categoryId, basePrice: '10.00' });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/admin/products/:id ─────────────────────────────────────────────

describe('PATCH /api/admin/products/:id', () => {
  it('updates product + writes AdminActionLog with before/after diff', async () => {
    const slug = `${SLUG_PREFIX}patch-${Date.now()}`;
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Before Tee', slug, categoryId, basePrice: '199.00' });
    expect(createRes.status).toBe(201);
    const productId: string = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'After Tee', status: 'ACTIVE' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.name).toBe('After Tee');
    expect(patchRes.body.status).toBe('ACTIVE');

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: adminId, resourceType: 'product', resourceId: productId, action: 'update' },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, Record<string, unknown>>;
    expect(diff['before']?.['name']).toBe('Before Tee');
    expect(diff['after']?.['name']).toBe('After Tee');
  });

  it('404 on unknown product id', async () => {
    const res = await request(app)
      .patch('/api/admin/products/nonexistent-id')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/admin/products/:id ────────────────────────────────────────────

describe('DELETE /api/admin/products/:id (soft archive)', () => {
  it('archives product + writes AdminActionLog', async () => {
    const slug = `${SLUG_PREFIX}delete-${Date.now()}`;
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delete Me', slug, categoryId, basePrice: '99.00', status: 'ACTIVE' });
    expect(createRes.status).toBe(201);
    const productId: string = createRes.body.id;

    const delRes = await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(204);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product?.status).toBe('ARCHIVED');

    const log = await prisma.adminActionLog.findFirst({
      where: {
        actorId: adminId,
        resourceType: 'product',
        resourceId: productId,
        action: 'archive',
      },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, Record<string, unknown>>;
    expect(diff['after']?.['status']).toBe('ARCHIVED');
  });

  it('409 PRODUCT_ALREADY_ARCHIVED on second DELETE', async () => {
    const slug = `${SLUG_PREFIX}double-archive-${Date.now()}`;
    const createRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Archive Twice', slug, categoryId, basePrice: '50.00', status: 'ACTIVE' });
    expect(createRes.status).toBe(201);
    const productId: string = createRes.body.id;

    await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_ALREADY_ARCHIVED');
  });
});

// ── POST /api/admin/skus/:id/adjust-stock ────────────────────────────────────

describe('POST /api/admin/skus/:skuId/adjust-stock', () => {
  let skuId: string;
  let initialStock: number;

  beforeAll(async () => {
    // Create a product + SKU for stock adjustment tests.
    const slug = `${SLUG_PREFIX}sku-${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        id: undefined,
        name: 'SKU Test Product',
        slug,
        description: '',
        categoryId,
        basePrice: '100.00',
        status: 'ACTIVE',
        skus: {
          create: {
            code: `${SLUG_PREFIX}sku-${Date.now()}`,
            price: '100.00',
            stock: 10,
            optionCombination: {},
          },
        },
      },
      include: { skus: true },
    });
    skuId = product.skus[0]!.id;
    initialStock = product.skus[0]!.stock;
  });

  it('increases stock + writes AdminActionLog', async () => {
    const res = await request(app)
      .post(`/api/admin/skus/${skuId}/adjust-stock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ delta: 5 });

    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(initialStock + 5);

    const log = await prisma.adminActionLog.findFirst({
      where: {
        actorId: adminId,
        resourceType: 'sku',
        resourceId: skuId,
        action: 'adjust_stock',
      },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, unknown>;
    expect(diff['delta']).toBe(5);
    expect(diff['after']).toEqual({ stock: initialStock + 5 });
  });

  it('409 when delta would make stock negative', async () => {
    const res = await request(app)
      .post(`/api/admin/skus/${skuId}/adjust-stock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ delta: -9999 });
    expect(res.status).toBe(409);
  });

  it('decreases stock + writes AdminActionLog', async () => {
    // First increase to a known level so the decrease is safe.
    const increaseRes = await request(app)
      .post(`/api/admin/skus/${skuId}/adjust-stock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ delta: 20 });
    expect(increaseRes.status).toBe(200);
    const stockBefore: number = increaseRes.body.stock;

    const res = await request(app)
      .post(`/api/admin/skus/${skuId}/adjust-stock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ delta: -3 });
    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(stockBefore - 3);

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: adminId, resourceType: 'sku', resourceId: skuId, action: 'adjust_stock' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, unknown>;
    expect(diff['delta']).toBe(-3);
    expect(diff['after']).toEqual({ stock: stockBefore - 3 });
  });

  it('400 on delta=0', async () => {
    const res = await request(app)
      .post(`/api/admin/skus/${skuId}/adjust-stock`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ delta: 0 });
    expect(res.status).toBe(400);
  });
});
