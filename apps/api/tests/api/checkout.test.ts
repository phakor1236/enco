import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';
import { issueAccessToken } from '../../src/services/authService.js';

/**
 * T4.4 acceptance:
 *   - POST /api/checkout → 201 { orderId, paymentIntentId }, order is PENDING.
 *   - POST /api/checkout → 400 CART_EMPTY / 409 OUT_OF_STOCK propagate correctly.
 *   - POST /api/webhooks/payment/mock — idempotent: N calls → exactly 1 PAID log.
 *   - AUTO_FAILURE: checkout returns PENDING; after setTimeout fires → CANCELLED + stock back.
 *   - GET /api/orders — returns paginated list for the authenticated user.
 *   - GET /api/orders/:id — returns order detail; 404 for unknown / other user's order.
 */

const app = createApp();

const EMAIL_DOMAIN = 'e2e-checkout-http.test';
const SKU_PREFIX = 'checkout-http-';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SHIPPING_ADDR = { name: '測試者', phone: '0912345678', city: '台北市', addr: '測試路1號' };

let userId: string;
let accessToken: string;
let productId: string;

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();

  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  productId = product.id;

  const user = await prisma.user.upsert({
    where: { email: `buyer@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `buyer@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
  });
  userId = user.id;
  accessToken = issueAccessToken({ id: user.id, role: user.role });
});

afterAll(async () => {
  await prisma.orderStatusLog.deleteMany({ where: { order: { userId } } });
  await prisma.paymentMock.deleteMany({ where: { order: { userId } } });
  await prisma.orderItem.deleteMany({ where: { order: { userId } } });
  // CouponUsage rows are cascade-deleted with the Order rows below
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.sku.deleteMany({ where: { code: { startsWith: SKU_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.coupon.deleteMany({ where: { code: { startsWith: 'TESTT53-API-' } } });
  await prisma.$disconnect();
});

interface SkuSpec {
  stock: number;
  qty: number;
  price?: string;
}

async function setupCart(specs: SkuSpec[]) {
  await prisma.cart.deleteMany({ where: { userId } });
  const skus = [];
  for (let i = 0; i < specs.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    const sku = await prisma.sku.create({
      data: {
        productId,
        code: `${SKU_PREFIX}${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        price: specs[i]!.price ?? '99.00',
        stock: specs[i]!.stock,
        optionCombination: { Size: `H${i}` },
        status: 'ACTIVE',
      },
    });
    skus.push(sku);
  }
  const cart = await prisma.cart.create({ data: { userId } });
  for (let i = 0; i < specs.length; i++) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.cartItem.create({
      data: { cartId: cart.id, skuId: skus[i]!.id, qty: specs[i]!.qty },
    });
  }
  return { skus };
}

// ============================================================================
// POST /api/checkout
// ============================================================================

async function createCoupon(overrides?: {
  code?: string;
  type?: 'FIXED' | 'PERCENT';
  value?: string;
  usageLimit?: number;
  minAmount?: string;
}) {
  return prisma.coupon.create({
    data: {
      code: overrides?.code ?? `TESTT53-API-${randomUUID().slice(0, 8)}`,
      type: overrides?.type ?? 'FIXED',
      value: overrides?.value ?? '10.00',
      usageLimit: overrides?.usageLimit ?? null,
      minAmount: overrides?.minAmount ?? null,
    },
  });
}

describe('POST /api/checkout', () => {
  it('creates PENDING order and returns orderId + paymentIntentId', async () => {
    const { skus } = await setupCart([{ stock: 10, qty: 2, price: '50.00' }]);

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shippingAddress: SHIPPING_ADDR, paymentMethod: 'mock_card' });

    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeTruthy();
    expect(res.body.paymentIntentId).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.orderId as string },
    });
    expect(order.status).toBe('PENDING');

    const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skus[0]!.id } });
    expect(sku.stock).toBe(8); // 10 - 2
  });

  it('returns 401 when no auth header', async () => {
    const res = await request(app)
      .post('/api/checkout')
      .send({ shippingAddress: SHIPPING_ADDR, paymentMethod: 'mock_card' });
    expect(res.status).toBe(401);
  });

  it('returns 400 CART_EMPTY when cart has no items', async () => {
    await prisma.cart.deleteMany({ where: { userId } });

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shippingAddress: SHIPPING_ADDR, paymentMethod: 'mock_card' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CART_EMPTY');
  });

  it('returns 409 OUT_OF_STOCK when stock is insufficient', async () => {
    await setupCart([{ stock: 1, qty: 5 }]);

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shippingAddress: SHIPPING_ADDR, paymentMethod: 'mock_card' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('applies FIXED coupon — discount + total correct, CouponUsage created', async () => {
    await setupCart([{ stock: 10, qty: 2, price: '50.00' }]); // subtotal = 100.00
    const coupon = await createCoupon({ value: '10.00' }); // FIXED 10 off

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        couponCode: coupon.code,
        outcomeMode: 'MANUAL',
      });

    expect(res.status).toBe(201);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.orderId as string },
    });
    expect(order.discount.toFixed(2)).toBe('10.00');
    expect(order.total.toFixed(2)).toBe('90.00');

    const usage = await prisma.couponUsage.findUnique({
      where: { couponId_userId: { couponId: coupon.id, userId } },
    });
    expect(usage).not.toBeNull();
    expect(usage?.orderId).toBe(order.id);
  });

  it('returns 422 COUPON_ALREADY_USED when same user tries coupon twice', async () => {
    const coupon = await createCoupon({ value: '5.00' });

    // First checkout — should succeed
    await setupCart([{ stock: 10, qty: 1, price: '50.00' }]);
    const first = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        couponCode: coupon.code,
        outcomeMode: 'MANUAL',
      });
    expect(first.status).toBe(201);

    // Second checkout with same coupon — should fail
    await setupCart([{ stock: 10, qty: 1, price: '50.00' }]);
    const second = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        couponCode: coupon.code,
        outcomeMode: 'MANUAL',
      });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('COUPON_ALREADY_USED');
  });

  it('applies PERCENT coupon — discount capped at subtotal when value > 100', async () => {
    await setupCart([{ stock: 10, qty: 1, price: '50.00' }]); // subtotal = 50.00
    // 10% of 50 = 5.00; value=10 means 10% off
    const coupon = await createCoupon({ type: 'PERCENT', value: '10' });

    const res = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        couponCode: coupon.code,
        outcomeMode: 'MANUAL',
      });

    expect(res.status).toBe(201);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.orderId as string },
    });
    expect(order.discount.toFixed(2)).toBe('5.00'); // 50 * 10 / 100
    expect(order.total.toFixed(2)).toBe('45.00');
  });
});

// ============================================================================
// GET /api/orders + GET /api/orders/:id
// ============================================================================

describe('GET /api/orders', () => {
  it("returns authenticated user's order list", async () => {
    await setupCart([{ stock: 5, qty: 1 }]);

    const checkoutRes = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shippingAddress: SHIPPING_ADDR, paymentMethod: 'mock_card', outcomeMode: 'MANUAL' });
    expect(checkoutRes.status).toBe(201);

    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThan(0);

    const found = (res.body.items as { id: string }[]).find(
      (o) => o.id === checkoutRes.body.orderId,
    );
    expect(found).toBeDefined();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/orders/:id', () => {
  it('returns full order detail', async () => {
    await setupCart([{ stock: 5, qty: 1, price: '75.00' }]);

    const checkoutRes = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shippingAddress: SHIPPING_ADDR, paymentMethod: 'mock_card', outcomeMode: 'MANUAL' });
    expect(checkoutRes.status).toBe(201);

    const res = await request(app)
      .get(`/api/orders/${checkoutRes.body.orderId as string}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(checkoutRes.body.orderId);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.total).toBeDefined();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.paymentStatus).toBe('PENDING');
  });

  it('returns 404 for an unknown order id', async () => {
    const res = await request(app)
      .get('/api/orders/nonexistent-id')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it("returns 404 (not 403) for another user's order id — avoids leaking existence", async () => {
    // Create a second user and an order under their account
    const other = await prisma.user.upsert({
      where: { email: `other@${EMAIL_DOMAIN}` },
      update: {},
      create: { email: `other@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH, role: 'CUSTOMER' },
    });
    const otherOrder = await prisma.order.create({
      data: {
        userId: other.id,
        status: 'PENDING',
        paymentIntentId: randomUUID(),
        subtotal: '0',
        total: '0',
        shippingAddress: { name: 'x', phone: 'x', city: 'x', addr: 'x' },
        paymentMethod: 'mock_card',
      },
    });

    const res = await request(app)
      .get(`/api/orders/${otherOrder.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');

    // cleanup
    await prisma.order.delete({ where: { id: otherOrder.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});

// ============================================================================
// POST /api/webhooks/payment/mock — idempotency
// ============================================================================

describe('POST /api/webhooks/payment/mock', () => {
  it('repeated calls produce exactly one PAID status log', async () => {
    await setupCart([{ stock: 10, qty: 1 }]);

    const checkoutRes = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        outcomeMode: 'MANUAL', // disable auto-timer to avoid interference
      });
    expect(checkoutRes.status).toBe(201);
    const { orderId, paymentIntentId } = checkoutRes.body as {
      orderId: string;
      paymentIntentId: string;
    };

    // First, manually update the PaymentMock to AUTO_SUCCESS so the webhook
    // processes it (MANUAL was used above only to suppress the setTimeout).
    await prisma.paymentMock.updateMany({
      where: { orderId },
      data: { outcomeMode: 'AUTO_SUCCESS' },
    });

    // Fire webhook 3 times
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      const webhookRes = await request(app)
        .post('/api/webhooks/payment/mock')
        .send({ paymentIntentId });
      expect(webhookRes.status).toBe(200);
    }

    // Strictly one PAID log entry
    const logCount = await prisma.orderStatusLog.count({
      where: { orderId, toStatus: 'PAID' },
    });
    expect(logCount).toBe(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');
    expect(order.paidAt).not.toBeNull();
  });
});

// ============================================================================
// AUTO_FAILURE flow
// ============================================================================

describe('AUTO_FAILURE flow', () => {
  it('order is PENDING immediately; after timer fires it is CANCELLED with stock restored', async () => {
    const { skus } = await setupCart([{ stock: 10, qty: 3 }]);

    const checkoutRes = await request(app)
      .post('/api/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        outcomeMode: 'AUTO_FAILURE',
      });
    expect(checkoutRes.status).toBe(201);
    const { orderId } = checkoutRes.body as { orderId: string };

    // Immediately after checkout: order is PENDING, stock already decremented
    const orderImmediate = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderImmediate.status).toBe('PENDING');

    const skuMid = await prisma.sku.findUniqueOrThrow({ where: { id: skus[0]!.id } });
    expect(skuMid.stock).toBe(7); // 10 - 3

    // Poll until the timer-driven CANCELLED transition lands (or 5s deadline).
    const deadline = Date.now() + 5_000;
    let orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    while (orderAfter.status !== 'CANCELLED' && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      // eslint-disable-next-line no-await-in-loop
      orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    }
    expect(orderAfter.status).toBe('CANCELLED');

    // Stock fully restored by restock()
    const skuAfter = await prisma.sku.findUniqueOrThrow({ where: { id: skus[0]!.id } });
    expect(skuAfter.stock).toBe(10);
  }, 10_000);
});
