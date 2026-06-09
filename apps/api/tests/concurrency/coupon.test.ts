import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';
import { issueAccessToken } from '../../src/services/authService.js';

/**
 * T5.3 — concurrent checkout with a usageLimit=1 coupon.
 *
 * Two users each have their own cart (same SKU, enough stock).
 * Both fire POST /api/checkout with the same couponCode simultaneously.
 * The advisory lock inside checkoutService serialises them — exactly one
 * wins and gets a CouponUsage row; the other sees count >= usageLimit and
 * gets 422 COUPON_LIMIT_REACHED.
 *
 * Expected invariants:
 *   1. Exactly 1 response is 201.
 *   2. The other response is 422 COUPON_LIMIT_REACHED.
 *   3. Exactly 1 CouponUsage row for this coupon.
 *   4. Exactly 1 Order row carries a non-zero discount.
 */

const app = createApp();

const EMAIL_DOMAIN = 'e2e-coupon-concurrency.test';
const SKU_PREFIX = 'coupon-conc-';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SHIPPING_ADDR = { name: '測試者', phone: '0912345678', city: '台北市', addr: '測試路1號' };

let productId: string;
let couponId: string;
let couponCode: string;
const userIds: string[] = [];
const tokens: string[] = [];
const skuIds: string[] = [];

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();

  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  productId = product.id;

  // Create usageLimit=1 coupon
  const coupon = await prisma.coupon.create({
    data: {
      code: `TESTT53-CONC-${Date.now()}`,
      type: 'FIXED',
      value: '20.00',
      usageLimit: 1,
    },
  });
  couponId = coupon.id;
  couponCode = coupon.code;

  // Create 2 users, each with their own cart containing distinct SKUs (enough stock)
  for (let i = 0; i < 2; i++) {
    // eslint-disable-next-line no-await-in-loop
    const user = await prisma.user.upsert({
      where: { email: `racer${i}@${EMAIL_DOMAIN}` },
      update: {},
      create: {
        email: `racer${i}@${EMAIL_DOMAIN}`,
        passwordHash: DUMMY_HASH,
        role: 'CUSTOMER',
      },
    });
    userIds.push(user.id);
    tokens.push(issueAccessToken({ id: user.id, role: user.role }));

    // eslint-disable-next-line no-await-in-loop
    const sku = await prisma.sku.create({
      data: {
        productId,
        code: `${SKU_PREFIX}${Date.now()}-${i}`,
        price: '100.00',
        stock: 10,
        optionCombination: { Size: `C${i}` },
        status: 'ACTIVE',
      },
    });
    skuIds.push(sku.id);

    // eslint-disable-next-line no-await-in-loop
    const cart = await prisma.cart.create({ data: { userId: user.id } });
    // eslint-disable-next-line no-await-in-loop
    await prisma.cartItem.create({ data: { cartId: cart.id, skuId: sku.id, qty: 1 } });
  }
});

afterAll(async () => {
  for (const uid of userIds) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.orderStatusLog.deleteMany({ where: { order: { userId: uid } } });
    // eslint-disable-next-line no-await-in-loop
    await prisma.paymentMock.deleteMany({ where: { order: { userId: uid } } });
    // eslint-disable-next-line no-await-in-loop
    await prisma.orderItem.deleteMany({ where: { order: { userId: uid } } });
    // CouponUsage cascade-deleted with Order
    // eslint-disable-next-line no-await-in-loop
    await prisma.order.deleteMany({ where: { userId: uid } });
    // eslint-disable-next-line no-await-in-loop
    await prisma.cart.deleteMany({ where: { userId: uid } });
  }
  await prisma.sku.deleteMany({ where: { code: { startsWith: SKU_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.coupon.delete({ where: { id: couponId } });
  await prisma.$disconnect();
});

it('usageLimit=1 coupon: exactly 1 checkout wins, the other gets COUPON_LIMIT_REACHED', async () => {
  const results = await Promise.all(
    tokens.map((token) =>
      request(app).post('/api/checkout').set('Authorization', `Bearer ${token}`).send({
        shippingAddress: SHIPPING_ADDR,
        paymentMethod: 'mock_card',
        couponCode,
        outcomeMode: 'MANUAL',
      }),
    ),
  );

  const successes = results.filter((r) => r.status === 201);
  const failures = results.filter((r) => r.status === 422);

  expect(successes).toHaveLength(1);
  expect(failures).toHaveLength(1);
  expect(failures[0]!.body.error.code).toBe('COUPON_LIMIT_REACHED');

  // Exactly 1 CouponUsage row
  const usageCount = await prisma.couponUsage.count({ where: { couponId } });
  expect(usageCount).toBe(1);

  // Exactly 1 order has a non-zero discount
  const ordersWithDiscount = await prisma.order.findMany({
    where: { userId: { in: userIds }, discount: { gt: 0 } },
  });
  expect(ordersWithDiscount).toHaveLength(1);
  expect(ordersWithDiscount[0]!.discount.toFixed(2)).toBe('20.00');
  expect(ordersWithDiscount[0]!.total.toFixed(2)).toBe('80.00');
});
