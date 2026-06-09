import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';
import { issueAccessToken } from '../../src/services/authService.js';

/**
 * T4.5 — HTTP-level checkout concurrency.
 *
 * Why HTTP and not service-level Promise.all:
 *   Prisma interactive transactions serialize their own async chain on a single
 *   connection. `Promise.all([checkout(user1), checkout(user2)])` would queue
 *   the two calls sequentially inside the pool, giving a false green even if
 *   the conditional-decrement guard is removed. Supertest requests each open
 *   an independent DB connection, producing real row-level lock contention.
 *
 * Setup:
 *   CONCURRENCY users, each with their own cart containing the SAME SKU (qty=1).
 *   Stock is reset to 1 before every run so only one checkout can succeed.
 *
 * Expected invariants:
 *   1. Exactly 1 response is 201.
 *   2. Every non-201 response is 409 OUT_OF_STOCK.
 *   3. Final SKU stock = 0  (no oversell, no phantom double-decrement).
 *   4. Exactly 1 Order row across all test users.
 *
 * Inversion check (manual, run when changing the guard):
 *   In checkoutService.ts, remove `stock: { gte: item.qty }` from the
 *   updateMany WHERE clause so stock is decremented unconditionally. Re-run
 *   this test — it MUST fail (stock ends up negative / multiple 201s). This
 *   confirms the test is actually exercising the guard, not just passing on luck.
 */

const app = createApp();

const CONCURRENCY = 5;
const EMAIL_DOMAIN = 'e2e-concurrency.test';
const SKU_CODE = `concurrent-sku-t4.5-${Date.now()}`;
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SHIPPING_ADDR = {
  name: '並發測試者',
  phone: '0900000000',
  city: '台北市',
  addr: '並發路1號',
};

let skuId: string;
let userIds: string[];
let tokens: string[];

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();

  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      code: SKU_CODE,
      price: '99.00',
      stock: 1,
      optionCombination: { Size: 'Concurrency' },
      status: 'ACTIVE',
    },
  });
  skuId = sku.id;

  // Create CONCURRENCY independent users, each with their own access token.
  // Carts are recreated per-test so stock + cart state are always clean.
  userIds = [];
  tokens = [];
  for (let i = 0; i < CONCURRENCY; i++) {
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
  }
});

afterAll(async () => {
  // Cascade-delete in FK dependency order.
  await prisma.orderStatusLog.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.paymentMock.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sku.deleteMany({ where: { code: SKU_CODE } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

/** Reset state before each run: stock back to 1, fresh cart-per-user. */
async function resetState(): Promise<void> {
  // Wipe any orders from a previous run to keep count assertions clean.
  await prisma.orderStatusLog.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.paymentMock.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.orderItem.deleteMany({ where: { order: { userId: { in: userIds } } } });
  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });

  await prisma.sku.update({ where: { id: skuId }, data: { stock: 1 } });

  for (const userId of userIds) {
    // eslint-disable-next-line no-await-in-loop
    const cart = await prisma.cart.create({ data: { userId } });
    // eslint-disable-next-line no-await-in-loop
    await prisma.cartItem.create({ data: { cartId: cart.id, skuId, qty: 1 } });
  }
}

it(`${CONCURRENCY} concurrent checkouts on stock=1 — exactly 1 succeeds, rest get 409`, async () => {
  await resetState();

  // All CONCURRENCY requests dispatched in the same microtask tick so
  // they overlap at the DB transaction level.
  const responses = await Promise.all(
    tokens.map((token) =>
      request(app)
        .post('/api/checkout')
        .set('Authorization', `Bearer ${token}`)
        // MANUAL disables the auto-payment timer so it doesn't fire during
        // cleanup and race against afterAll deletes.
        .send({
          shippingAddress: SHIPPING_ADDR,
          paymentMethod: 'mock_card',
          outcomeMode: 'MANUAL',
        }),
    ),
  );

  const successes = responses.filter((r) => r.status === 201);
  const failures = responses.filter((r) => r.status !== 201);

  // Invariant 1: exactly one order placed
  expect(successes).toHaveLength(1);

  // Invariant 2: all failures are 409 OUT_OF_STOCK (not 500, not 400 CART_EMPTY)
  expect(failures).toHaveLength(CONCURRENCY - 1);
  for (const f of failures) {
    expect(f.status).toBe(409);
    expect(f.body.error.code).toBe('OUT_OF_STOCK');
  }

  // Invariant 3: stock exactly 0 — no oversell, no phantom double-decrement
  const finalSku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
  expect(finalSku.stock).toBe(0);

  // Invariant 4: exactly one Order row across all test users
  const orderCount = await prisma.order.count({ where: { userId: { in: userIds } } });
  expect(orderCount).toBe(1);
}, 15_000);
