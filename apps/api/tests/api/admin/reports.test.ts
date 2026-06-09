import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../../src/app.js';
import { prisma } from '../../../src/lib/db.js';
import { issueAccessToken } from '../../../src/services/authService.js';

/**
 * T6.6 acceptance:
 *   - GET /api/admin/reports/daily  → rows with date / orderCount / revenue
 *   - GET /api/admin/reports/monthly → rows with month / orderCount / revenue
 *   - GET /api/admin/reports/by-product → rows with productId / productName / totalQty / revenue
 *   - Revenue only counts PAID / SHIPPED / COMPLETED orders (not PENDING / CANCELLED / REFUNDED)
 *   - Auth: ADMIN or SUPER_ADMIN only; 401 / 403 for others
 */

const app = createApp();

const EMAIL_DOMAIN = 'admin-reports-test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SKU_PREFIX = 't66-sku-';
const SHIPPING_ADDR = { name: 'Test', phone: '0912345678', city: 'Taipei', addr: 'Test Rd 1' };

let adminToken: string;
let customerToken: string;

// Dedicated product for exact revenue assertions (isolated from other test suites).
let seededProductId: string;

const createdOrderIds: string[] = [];
const createdSkuIds: string[] = [];
const createdProductIds: string[] = [];

beforeAll(async () => {
  const { seedCatalog } = await import('../../../prisma/seed/products.js');
  await seedCatalog();

  const admin = await prisma.user.upsert({
    where: { email: `admin@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `admin@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'ADMIN' },
  });
  adminToken = issueAccessToken({ id: admin.id, role: admin.role });

  const customer = await prisma.user.upsert({
    where: { email: `customer@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `customer@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  customerToken = issueAccessToken({ id: customer.id, role: customer.role });

  // Create a dedicated product so revenue assertions are fully isolated.
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  const testProduct = await prisma.product.create({
    data: {
      name: 'T66 Reports Test Product',
      slug: `t66-report-product-${Date.now()}`,
      description: '',
      basePrice: '100.00',
      status: 'ACTIVE',
      categoryId: category.id,
    },
  });
  seededProductId = testProduct.id;
  createdProductIds.push(testProduct.id);

  const skuA = await prisma.sku.create({
    data: {
      productId: testProduct.id,
      code: `${SKU_PREFIX}A-${Date.now()}`,
      price: '100.00',
      stock: 50,
      optionCombination: {},
    },
  });
  createdSkuIds.push(skuA.id);

  const skuB = await prisma.sku.create({
    data: {
      productId: testProduct.id,
      code: `${SKU_PREFIX}B-${Date.now()}`,
      price: '200.00',
      stock: 50,
      optionCombination: {},
    },
  });
  createdSkuIds.push(skuB.id);

  // Seed 3 PAID orders (should appear in reports) and 1 CANCELLED (should not).
  const makeOrder = async (
    skuId: string,
    unitPrice: string,
    qty: number,
    total: string,
    status: 'PAID' | 'CANCELLED',
  ) => {
    const order = await prisma.order.create({
      data: {
        userId: admin.id,
        status,
        subtotal: total,
        discount: '0.00',
        shippingFee: '0.00',
        total,
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        paidAt: status === 'PAID' ? new Date() : null,
        items: {
          create: { skuId, qty, unitPrice, skuSnapshot: { code: skuId, price: unitPrice } },
        },
      },
    });
    createdOrderIds.push(order.id);
  };

  // 2 × skuA (100 each) = 200; 1 × skuB (200) = 200; total PAID revenue = 400
  await makeOrder(skuA.id, '100.00', 1, '100.00', 'PAID');
  await makeOrder(skuA.id, '100.00', 1, '100.00', 'PAID');
  await makeOrder(skuB.id, '200.00', 1, '200.00', 'PAID');
  // CANCELLED — must not appear in sums
  await makeOrder(skuA.id, '100.00', 1, '100.00', 'CANCELLED');
});

afterAll(async () => {
  await prisma.orderStatusLog.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.paymentMock.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.shipmentMock.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.sku.deleteMany({ where: { id: { in: createdSkuIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

// ── Auth gates ────────────────────────────────────────────────────────────────

describe('auth gates', () => {
  it('unauthenticated → 401 on daily', async () => {
    const res = await request(app).get('/api/admin/reports/daily');
    expect(res.status).toBe(401);
  });

  it('customer → 403 on daily', async () => {
    const res = await request(app)
      .get('/api/admin/reports/daily')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/reports/daily ──────────────────────────────────────────────

describe('GET /api/admin/reports/daily', () => {
  it('returns rows with correct shape', async () => {
    const res = await request(app)
      .get('/api/admin/reports/daily?days=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.days).toBe(1);

    if (res.body.rows.length > 0) {
      const row = res.body.rows[0] as { date: string; orderCount: number; revenue: string };
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.orderCount).toBe('number');
      expect(typeof row.revenue).toBe('string');
    }
  });

  it("today's revenue is at least 400.00 (3 PAID orders seeded)", async () => {
    const res = await request(app)
      .get('/api/admin/reports/daily?days=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const rows = res.body.rows as { date: string; orderCount: number; revenue: string }[];
    const todayRevenue = rows.reduce((sum, r) => sum + parseFloat(r.revenue), 0);
    // Seeded 400; DB may have more from other test suites sharing the test DB.
    expect(todayRevenue).toBeGreaterThanOrEqual(400);
  });
});

// ── GET /api/admin/reports/monthly ────────────────────────────────────────────

describe('GET /api/admin/reports/monthly', () => {
  it('returns rows with month and revenue', async () => {
    const res = await request(app)
      .get('/api/admin/reports/monthly?months=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);
    expect(res.body.months).toBe(1);

    if (res.body.rows.length > 0) {
      const row = res.body.rows[0] as { month: string; orderCount: number; revenue: string };
      expect(row.month).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof row.orderCount).toBe('number');
      expect(parseFloat(row.revenue)).toBeGreaterThanOrEqual(400);
    }
  });
});

// ── GET /api/admin/reports/by-product ────────────────────────────────────────

describe('GET /api/admin/reports/by-product', () => {
  it('returns rows with productId, productName, totalQty, revenue', async () => {
    const res = await request(app)
      .get('/api/admin/reports/by-product?limit=50')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rows)).toBe(true);

    for (const row of res.body.rows as {
      productId: string;
      productName: string;
      totalQty: number;
      revenue: string;
    }[]) {
      expect(typeof row.productId).toBe('string');
      expect(typeof row.productName).toBe('string');
      expect(typeof row.totalQty).toBe('number');
      expect(typeof row.revenue).toBe('string');
    }
  });

  it('CANCELLED order is excluded — seeded product revenue is exactly 400.00', async () => {
    // Uses the dedicated seededProductId so the assertion is isolated from other test suites.
    // 3 PAID orders total NT$400; 1 CANCELLED (NT$100) must NOT be counted.
    const res = await request(app)
      .get('/api/admin/reports/by-product?limit=100')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const rows = res.body.rows as { productId: string; revenue: string }[];
    const seededRow = rows.find((r) => r.productId === seededProductId);
    expect(seededRow).toBeDefined();
    expect(parseFloat(seededRow!.revenue)).toBe(400);
  });

  it('date filter narrows results', async () => {
    const futureDate = '2099-01-01';
    const res = await request(app)
      .get(`/api/admin/reports/by-product?startDate=${futureDate}&endDate=${futureDate}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(0);
  });

  it('400 when startDate is after endDate', async () => {
    const res = await request(app)
      .get('/api/admin/reports/by-product?startDate=2099-01-02&endDate=2099-01-01')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});
