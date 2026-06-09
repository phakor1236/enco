import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../../src/app.js';
import { prisma } from '../../../src/lib/db.js';
import { issueAccessToken } from '../../../src/services/authService.js';

/**
 * T6.5 acceptance:
 *   - GET /api/admin/coupons → cursor-paginated list
 *   - POST /api/admin/coupons → create + AdminActionLog
 *   - PATCH /api/admin/coupons/:id → update + AdminActionLog
 *   - DELETE /api/admin/coupons/:id → hard delete (204) + AdminActionLog
 *   - DELETE with usages → 409 COUPON_IN_USE
 *   - Customer → 403; demo write → 403 DEMO_ACCOUNT_READONLY
 */

const app = createApp();

const EMAIL_DOMAIN = 'admin-coupons-test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const CODE_PREFIX = 'T65-';

let adminId: string;
let adminToken: string;
let customerToken: string;
let demoToken: string;

beforeAll(async () => {
  const admin = await prisma.user.upsert({
    where: { email: `admin@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `admin@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'ADMIN' },
  });
  adminId = admin.id;
  adminToken = issueAccessToken({ id: admin.id, role: admin.role });

  const customer = await prisma.user.upsert({
    where: { email: `customer@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `customer@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  customerToken = issueAccessToken({ id: customer.id, role: customer.role });

  const demo = await prisma.user.upsert({
    where: { email: `demo@${EMAIL_DOMAIN}` },
    update: {},
    create: {
      email: `demo@${EMAIL_DOMAIN}`,
      passwordHash: DUMMY_HASH,
      role: 'ADMIN',
      isDemoReadonly: true,
    },
  });
  demoToken = issueAccessToken({ id: demo.id, role: demo.role });
});

afterAll(async () => {
  // Clean up coupons created by these tests (by code prefix) and related rows.
  const coupons = await prisma.coupon.findMany({
    where: { code: { startsWith: CODE_PREFIX } },
    select: { id: true },
  });
  const couponIds = coupons.map((c) => c.id);

  // The COUPON_IN_USE test creates an order for adminId — clean it up in FK order.
  const testOrders = await prisma.order.findMany({
    where: { userId: adminId },
    select: { id: true },
  });
  const testOrderIds = testOrders.map((o) => o.id);

  await prisma.adminActionLog.deleteMany({ where: { actorId: adminId } });
  await prisma.couponUsage.deleteMany({ where: { couponId: { in: couponIds } } });
  await prisma.orderStatusLog.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.paymentMock.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.shipmentMock.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: testOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: testOrderIds } } });
  await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
  await prisma.sku.deleteMany({ where: { code: { startsWith: 't65-inuse-sku-' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

// ── Auth gates ────────────────────────────────────────────────────────────────

describe('auth gates', () => {
  it('unauthenticated → 401', async () => {
    const res = await request(app).get('/api/admin/coupons');
    expect(res.status).toBe(401);
  });

  it('customer → 403 on GET', async () => {
    const res = await request(app)
      .get('/api/admin/coupons')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('demo account write → 403 DEMO_ACCOUNT_READONLY on POST', async () => {
    const res = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${demoToken}`)
      .send({ code: `${CODE_PREFIX}DEMO`, type: 'FIXED', value: '10.00' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEMO_ACCOUNT_READONLY');
  });
});

// ── POST /api/admin/coupons ───────────────────────────────────────────────────

describe('POST /api/admin/coupons', () => {
  it('creates a FIXED coupon and writes AdminActionLog', async () => {
    const code = `${CODE_PREFIX}FIXED-${Date.now()}`;
    const res = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, type: 'FIXED', value: '50.00', usageLimit: 100 });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(code);
    expect(res.body.type).toBe('FIXED');
    expect(res.body.value).toBe('50.00');
    expect(res.body.usageLimit).toBe(100);

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: adminId, resourceType: 'coupon', action: 'create' },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, unknown>;
    expect(diff['code']).toBe(code);
  });

  it('creates a PERCENT coupon with date window', async () => {
    const code = `${CODE_PREFIX}PCT-${Date.now()}`;
    const res = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code,
        type: 'PERCENT',
        value: '10.00',
        minAmount: '200.00',
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-12-31T23:59:59.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('PERCENT');
    expect(res.body.minAmount).toBe('200.00');
    expect(res.body.startsAt).toBeTruthy();
    expect(res.body.endsAt).toBeTruthy();
  });

  it('409 on duplicate code', async () => {
    const code = `${CODE_PREFIX}DUP-${Date.now()}`;
    await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, type: 'FIXED', value: '5.00' });

    const res = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, type: 'FIXED', value: '5.00' });

    expect(res.status).toBe(409);
  });
});

// ── GET /api/admin/coupons ────────────────────────────────────────────────────

describe('GET /api/admin/coupons', () => {
  it('returns cursor-paginated list', async () => {
    const res = await request(app)
      .get('/api/admin/coupons?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect('nextCursor' in res.body).toBe(true);
  });
});

// ── PATCH /api/admin/coupons/:id ──────────────────────────────────────────────

describe('PATCH /api/admin/coupons/:id', () => {
  it('updates value and writes AdminActionLog', async () => {
    const createRes = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: `${CODE_PREFIX}PATCH-${Date.now()}`, type: 'FIXED', value: '20.00' });
    const couponId = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/admin/coupons/${couponId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '30.00', usageLimit: 50 });

    expect(res.status).toBe(200);
    expect(res.body.value).toBe('30.00');
    expect(res.body.usageLimit).toBe(50);

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: adminId, resourceType: 'coupon', resourceId: couponId, action: 'update' },
    });
    expect(log).not.toBeNull();
    const diff = log!.diff as Record<string, Record<string, unknown>>;
    expect(diff['before']?.['value']).toBe('20.00');
  });

  it('404 on unknown id', async () => {
    const res = await request(app)
      .patch('/api/admin/coupons/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: '10.00' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUPON_NOT_FOUND');
  });

  it('clears optional fields with null', async () => {
    const createRes = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: `${CODE_PREFIX}NULL-${Date.now()}`,
        type: 'FIXED',
        value: '10.00',
        usageLimit: 5,
      });
    const couponId = createRes.body.id as string;

    const res = await request(app)
      .patch(`/api/admin/coupons/${couponId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ usageLimit: null });

    expect(res.status).toBe(200);
    expect(res.body.usageLimit).toBeNull();
  });
});

// ── DELETE /api/admin/coupons/:id ─────────────────────────────────────────────

describe('DELETE /api/admin/coupons/:id', () => {
  it('deletes unused coupon (204) and writes AdminActionLog', async () => {
    const createRes = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: `${CODE_PREFIX}DEL-${Date.now()}`, type: 'FIXED', value: '5.00' });
    const couponId = createRes.body.id as string;

    const res = await request(app)
      .delete(`/api/admin/coupons/${couponId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);

    const gone = await prisma.coupon.findUnique({ where: { id: couponId } });
    expect(gone).toBeNull();

    const log = await prisma.adminActionLog.findFirst({
      where: { actorId: adminId, resourceType: 'coupon', resourceId: couponId, action: 'delete' },
    });
    expect(log).not.toBeNull();
  });

  it('409 COUPON_IN_USE when coupon has usages', async () => {
    // Create coupon and a fake usage directly in the DB.
    const createRes = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: `${CODE_PREFIX}INUSE-${Date.now()}`, type: 'FIXED', value: '5.00' });
    const couponId = createRes.body.id as string;

    // We need a user + order to attach the usage. Use the existing admin user.
    const { seedCatalog } = await import('../../../prisma/seed/products.js');
    await seedCatalog();
    const product = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    const sku = await prisma.sku.create({
      data: {
        productId: product.id,
        code: `t65-inuse-sku-${Date.now()}`,
        price: '100.00',
        stock: 5,
        optionCombination: {},
      },
    });
    const order = await prisma.order.create({
      data: {
        userId: adminId,
        status: 'PAID',
        subtotal: '100.00',
        discount: '5.00',
        shippingFee: '0.00',
        total: '95.00',
        shippingAddress: { name: 'Test', phone: '0912345678', city: 'Taipei', addr: 'Test Rd 1' },
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
    await prisma.couponUsage.create({
      data: { couponId, userId: adminId, orderId: order.id },
    });

    const res = await request(app)
      .delete(`/api/admin/coupons/${couponId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUPON_IN_USE');
  });

  it('404 on unknown id', async () => {
    const res = await request(app)
      .delete('/api/admin/coupons/nonexistent')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COUPON_NOT_FOUND');
  });
});
