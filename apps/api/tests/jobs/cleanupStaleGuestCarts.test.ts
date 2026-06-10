import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { runCleanupStaleGuestCarts } from '../../src/jobs/cleanupStaleGuestCarts.js';

/**
 * T7.5 acceptance:
 *   - Guest carts (userId=NULL) with updatedAt > 7 days ago are deleted (+ items via CASCADE)
 *   - Fresh guest carts (< 7 days) are kept
 *   - Member carts (userId IS NOT NULL) are never deleted regardless of age
 */

const EMAIL_DOMAIN = 't75-guest-carts.test.internal';
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuv0123456789abcdefghijklmnopqrstuv';
const SKU_PREFIX = 't75-';

let userId: string;
let skuId: string;

const createdCartIds: string[] = [];

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();

  const user = await prisma.user.upsert({
    where: { email: `user@${EMAIL_DOMAIN}` },
    update: {},
    create: { email: `user@${EMAIL_DOMAIN}`, passwordHash: DUMMY_HASH },
  });
  userId = user.id;

  const product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const sku = await prisma.sku.create({
    data: {
      productId: product.id,
      code: `${SKU_PREFIX}${Date.now()}`,
      price: '100.00',
      stock: 50,
      optionCombination: {},
    },
  });
  skuId = sku.id;
});

afterAll(async () => {
  await prisma.cartItem.deleteMany({ where: { cartId: { in: createdCartIds } } });
  await prisma.cart.deleteMany({ where: { id: { in: createdCartIds } } });
  await prisma.sku.deleteMany({ where: { code: { startsWith: SKU_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

async function makeGuestCart(sessionId: string, stale: boolean) {
  const cart = await prisma.cart.create({
    data: {
      sessionId,
      items: { create: { skuId, qty: 1 } },
    },
  });
  createdCartIds.push(cart.id);

  if (stale) {
    // Prisma manages updatedAt automatically — use raw SQL to backdate it.
    const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago
    await prisma.$executeRaw`UPDATE carts SET updated_at = ${staleDate} WHERE id = ${cart.id}`;
  }

  return cart;
}

describe('runCleanupStaleGuestCarts', () => {
  it('deletes stale guest cart and its items', async () => {
    const cart = await makeGuestCart(`t75-stale-${Date.now()}`, true);
    const itemCount = await prisma.cartItem.count({ where: { cartId: cart.id } });
    expect(itemCount).toBe(1);

    await runCleanupStaleGuestCarts();

    const found = await prisma.cart.findUnique({ where: { id: cart.id } });
    expect(found).toBeNull();
    // Remove from tracking since cascade-deleted.
    createdCartIds.splice(createdCartIds.indexOf(cart.id), 1);
  });

  it('keeps fresh guest cart (< 7 days)', async () => {
    const cart = await makeGuestCart(`t75-fresh-${Date.now()}`, false);

    await runCleanupStaleGuestCarts();

    const found = await prisma.cart.findUnique({ where: { id: cart.id } });
    expect(found).not.toBeNull();
  });

  it('never deletes member cart regardless of age', async () => {
    const memberCart = await prisma.cart.create({ data: { userId } });
    createdCartIds.push(memberCart.id);
    // Backdate to look stale.
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await prisma.$executeRaw`UPDATE carts SET updated_at = ${staleDate} WHERE id = ${memberCart.id}`;

    await runCleanupStaleGuestCarts();

    const found = await prisma.cart.findUnique({ where: { id: memberCart.id } });
    expect(found).not.toBeNull();
  });
});
