import { Prisma } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { withTestTx } from '../helpers/withTestTx.js';

/**
 * T3.1 schema constraints — hand-written in the migration so Prisma alone
 * can't enforce them. These tests assert that the DB rejects every illegal
 * shape the FE/service layer might accidentally produce.
 */
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Cart schema constraints (T3.1)', () => {
  it('CHECK carts_owner_required rejects a cart with neither user_id nor session_id', async () => {
    await withTestTx(async (tx) => {
      await expect(tx.cart.create({ data: {} })).rejects.toThrowError(/carts_owner_required/);
    });
  });

  it('partial UNIQUE carts_session_id_unique rejects a duplicate guest session', async () => {
    await withTestTx(async (tx) => {
      await tx.cart.create({ data: { sessionId: 'sess-X' } });
      await expect(tx.cart.create({ data: { sessionId: 'sess-X' } })).rejects.toThrowError(
        /Unique constraint|carts_session_id_unique/,
      );
    });
  });

  it('partial UNIQUE carts_user_id_unique rejects a duplicate logged-in cart', async () => {
    await withTestTx(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `cart-test-${Date.now()}@e2e-cart.test`,
          passwordHash: 'x',
          role: 'CUSTOMER',
        },
      });
      await tx.cart.create({ data: { userId: user.id } });
      await expect(tx.cart.create({ data: { userId: user.id } })).rejects.toThrowError(
        /Unique constraint|carts_user_id_unique/,
      );
    });
  });

  it('multiple guest carts with NULL user_id coexist (partial unique skips NULLs)', async () => {
    await withTestTx(async (tx) => {
      await tx.cart.create({ data: { sessionId: 'sess-A' } });
      await tx.cart.create({ data: { sessionId: 'sess-B' } });
      const count = await tx.cart.count({
        where: { userId: null, sessionId: { in: ['sess-A', 'sess-B'] } },
      });
      expect(count).toBe(2);
    });
  });

  it('CHECK cart_items_qty_positive rejects qty <= 0', async () => {
    await withTestTx(async (tx) => {
      const cart = await tx.cart.create({ data: { sessionId: 'sess-qty' } });
      const sku = await tx.sku.findFirstOrThrow({ where: { status: 'ACTIVE' } });
      await expect(
        tx.cartItem.create({ data: { cartId: cart.id, skuId: sku.id, qty: 0 } }),
      ).rejects.toThrowError(/cart_items_qty_positive/);
      await expect(
        tx.cartItem.create({ data: { cartId: cart.id, skuId: sku.id, qty: -3 } }),
      ).rejects.toThrowError(/cart_items_qty_positive/);
    });
  });

  it('UNIQUE (cart_id, sku_id) prevents adding the same SKU twice to one cart', async () => {
    await withTestTx(async (tx) => {
      const cart = await tx.cart.create({ data: { sessionId: 'sess-dup' } });
      const sku = await tx.sku.findFirstOrThrow({ where: { status: 'ACTIVE' } });
      await tx.cartItem.create({ data: { cartId: cart.id, skuId: sku.id, qty: 1 } });
      await expect(
        tx.cartItem.create({ data: { cartId: cart.id, skuId: sku.id, qty: 2 } }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    });
  });
});
