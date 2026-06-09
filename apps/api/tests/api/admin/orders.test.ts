import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../../src/app.js';
import { prisma } from '../../../src/lib/db.js';
import { issueAccessToken } from '../../../src/services/authService.js';

/**
 * T6.4 acceptance:
 *   - GET /api/admin/orders → paginated list of all orders
 *   - GET /api/admin/orders/:id → full order detail
 *   - POST /api/admin/orders/:id/ship → PAID→SHIPPED + AdminActionLog
 *   - POST /api/admin/orders/:id/refund → *→REFUNDED + AdminActionLog (SUPER_ADMIN only)
 *   - ADMIN cannot REFUND → 403
 *   - Demo account write → 403 DEMO_ACCOUNT_READONLY
 */

const app = createApp();

const EMAIL_DOMAIN = 'admin-orders-test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SKU_PREFIX = 't64-sku-';
const SHIPPING_ADDR = { name: 'Test', phone: '0912345678', city: 'Taipei', addr: 'Test Rd 1' };

let superAdminId: string;
let superAdminToken: string;
let adminToken: string;
let customerToken: string;

beforeAll(async () => {
  const { seedCatalog } = await import('../../../prisma/seed/products.js');
  await seedCatalog();

  const superAdmin = await prisma.user.upsert({
    where: { email: `super@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `super@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'SUPER_ADMIN' },
  });
  superAdminId = superAdmin.id;
  superAdminToken = issueAccessToken({ id: superAdmin.id, role: superAdmin.role });

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
});

afterAll(async () => {
  // Find all test SKUs so we can cascade-clean the orders that reference them.
  const skus = await prisma.sku.findMany({
    where: { code: { startsWith: SKU_PREFIX } },
    select: { id: true },
  });
  const skuIds = skus.map((s) => s.id);
  const orderItems = await prisma.orderItem.findMany({
    where: { skuId: { in: skuIds } },
    select: { orderId: true },
  });
  const orderIds = [...new Set(orderItems.map((i) => i.orderId))];

  // Delete in FK order: child rows first, then orders, then SKUs.
  await prisma.adminActionLog.deleteMany({ where: { actorId: superAdminId } });
  await prisma.orderStatusLog.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.paymentMock.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.shipmentMock.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.sku.deleteMany({ where: { id: { in: skuIds } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createPaidOrder(): Promise<{ orderId: string; skuId: string }> {
  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      code: `${SKU_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      price: '100.00',
      stock: 10,
      optionCombination: {},
    },
  });

  // Create a PAID order directly in the DB (bypasses HTTP to keep tests fast).
  const order = await prisma.order.create({
    data: {
      userId: (
        await prisma.user.findFirstOrThrow({
          where: { email: `customer@${EMAIL_DOMAIN}` },
          select: { id: true },
        })
      ).id,
      status: 'PAID',
      subtotal: '100.00',
      discount: '0.00',
      shippingFee: '0.00',
      total: '100.00',
      shippingAddress: SHIPPING_ADDR,
      paymentMethod: 'mock_card',
      paidAt: new Date(),
      items: {
        create: {
          skuId: sku.id,
          qty: 1,
          unitPrice: '100.00',
          skuSnapshot: { code: sku.code, price: '100.00' },
        },
      },
    },
  });

  return { orderId: order.id, skuId: sku.id };
}

// ── Auth gates ────────────────────────────────────────────────────────────────

describe('auth gates', () => {
  it('unauthenticated → 401 on GET /api/admin/orders', async () => {
    const res = await request(app).get('/api/admin/orders');
    expect(res.status).toBe(401);
  });

  it('customer → 403 on GET /api/admin/orders', async () => {
    const res = await request(app)
      .get('/api/admin/orders')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('ADMIN cannot REFUND → 403', async () => {
    const { orderId } = await createPaidOrder();
    const res = await request(app)
      .post(`/api/admin/orders/${orderId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

// ── GET /api/admin/orders ─────────────────────────────────────────────────────

describe('GET /api/admin/orders', () => {
  it('returns paginated order list', async () => {
    const res = await request(app)
      .get('/api/admin/orders?limit=5')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect('nextCursor' in res.body).toBe(true);
  });

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/admin/orders?status=PAID')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    for (const item of res.body.items as { status: string }[]) {
      expect(item.status).toBe('PAID');
    }
  });
});

// ── GET /api/admin/orders/:id ─────────────────────────────────────────────────

describe('GET /api/admin/orders/:id', () => {
  it('returns full order detail including items and statusLogs', async () => {
    const { orderId } = await createPaidOrder();
    const res = await request(app)
      .get(`/api/admin/orders/${orderId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.statusLogs)).toBe(true);
  });

  it('404 on unknown order id', async () => {
    const res = await request(app)
      .get('/api/admin/orders/nonexistent-id')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── POST /api/admin/orders/:id/ship ──────────────────────────────────────────

describe('POST /api/admin/orders/:id/ship', () => {
  it('PAID→SHIPPED + writes AdminActionLog', async () => {
    const { orderId } = await createPaidOrder();

    const res = await request(app)
      .post(`/api/admin/orders/${orderId}/ship`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ carrier: 'TestCarrier', trackingNo: 'TC-001', note: 'shipped by test' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SHIPPED');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('SHIPPED');
    expect(order.shippedAt).not.toBeNull();

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: superAdminId, resourceType: 'order', resourceId: orderId, action: 'ship' },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, Record<string, unknown>>;
    expect(diff['before']?.['status']).toBe('PAID');
    expect(diff['after']?.['status']).toBe('SHIPPED');
  });

  it('409 on invalid transition (PENDING→SHIPPED)', async () => {
    // Create a PENDING order directly
    const product = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: `${SKU_PREFIX}pending-${Date.now()}`,
        price: '50.00',
        stock: 5,
        optionCombination: {},
      },
    });
    const pendingOrder = await prisma.order.create({
      data: {
        userId: (
          await prisma.user.findFirstOrThrow({
            where: { email: `customer@${EMAIL_DOMAIN}` },
            select: { id: true },
          })
        ).id,
        status: 'PENDING',
        subtotal: '50.00',
        discount: '0.00',
        shippingFee: '0.00',
        total: '50.00',
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        items: {
          create: {
            skuId: sku.id,
            qty: 1,
            unitPrice: '50.00',
            skuSnapshot: { code: sku.code, price: '50.00' },
          },
        },
      },
    });

    const res = await request(app)
      .post(`/api/admin/orders/${pendingOrder.id}/ship`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
  });
});

// ── POST /api/admin/orders/:id/refund ─────────────────────────────────────────

describe('POST /api/admin/orders/:id/refund', () => {
  it('PAID→REFUNDED + writes AdminActionLog + restocks SKU', async () => {
    const { orderId, skuId } = await createPaidOrder();
    const skuBefore = await prisma.sku.findUniqueOrThrow({
      where: { id: skuId },
      select: { stock: true },
    });

    const res = await request(app)
      .post(`/api/admin/orders/${orderId}/refund`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ note: 'customer request' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REFUNDED');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('REFUNDED');

    // Restock side-effect from transitionOrder
    const skuAfter = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
    expect(skuAfter.stock).toBe(skuBefore.stock + 1);

    const log = await prisma.adminActionLog.findFirst({
      where: {
        actorId: superAdminId,
        resourceType: 'order',
        resourceId: orderId,
        action: 'refund',
      },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, Record<string, unknown>>;
    expect(diff['before']?.['status']).toBe('PAID');
    expect(diff['after']?.['status']).toBe('REFUNDED');
  });
});
