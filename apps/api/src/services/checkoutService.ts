import { randomUUID } from 'node:crypto';

import { Prisma, type PaymentOutcomeMode } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/db.js';

import { validateCoupon } from './couponService.js';

/**
 * T4.3 — checkout service
 *
 * Single atomic tx:
 *   1. Load user's cart (must be non-empty).
 *   2. For each line item: conditional `updateMany WHERE stock >= qty` to
 *      decrement. count=0 → throw OUT_OF_STOCK → entire tx rolls back so
 *      no partial stock changes persist.
 *   3. Create Order(PENDING) + OrderItems (unitPrice + skuSnapshot frozen at
 *      this moment) + PaymentMock(PENDING).
 *   4. Delete the cart (cascade-deletes CartItems).
 *
 * Returns { orderId, paymentIntentId }. The paymentIntentId is the
 * idempotency key stored on the Order row; T4.4's webhook handler uses it
 * for a conditional PAID transition (`WHERE paymentIntentId=? AND status='PENDING'`).
 *
 * T5.3 extended: if `couponCode` is supplied, `validateCoupon` is called inside
 * the tx (date / min / per-user checks), then a pg_advisory_xact_lock serialises
 * concurrent checkouts on the same coupon before the definitive count re-check.
 * CouponUsage is written in the same tx — a rollback on any downstream failure
 * automatically reverts it, letting the user retry with the same code.
 */

export interface CheckoutInput {
  shippingAddress: Prisma.InputJsonValue;
  paymentMethod: string;
  couponCode?: string;
  /** Defaults to AUTO_SUCCESS. Pass AUTO_FAILURE for the T8.9 unhappy-path test. */
  outcomeMode?: PaymentOutcomeMode;
}

export interface CheckoutResult {
  orderId: string;
  paymentIntentId: string;
}

export async function checkout(userId: string, input: CheckoutInput): Promise<CheckoutResult> {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({
      where: { userId },
      include: {
        items: {
          include: {
            sku: {
              include: {
                product: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError(ErrorCodes.CART_EMPTY, '購物車是空的', 400);
    }

    // Sequential conditional decrements — parallel writes on a single tx
    // connection can deadlock on overlapping rows (same reasoning as restock
    // in orderService.ts). Cart size is small so the sequential cost is negligible.
    for (const item of cart.items) {
      // eslint-disable-next-line no-await-in-loop
      const updated = await tx.sku.updateMany({
        where: { id: item.skuId, stock: { gte: item.qty } },
        data: { stock: { decrement: item.qty } },
      });
      if (updated.count === 0) {
        // Re-read stock after the failed update so the error reflects the
        // committed value, not the SELECT-time snapshot which may be stale
        // under concurrent checkouts (another tx may have decremented between
        // our cart read and this updateMany).
        const current = await tx.sku.findUnique({
          where: { id: item.skuId },
          select: { stock: true },
        });
        const available = current?.stock ?? 0;
        throw new AppError(
          ErrorCodes.OUT_OF_STOCK,
          `庫存不足：${item.sku.code} 目前僅剩 ${available} 件`,
          409,
          { skuId: item.skuId, available, requested: item.qty },
        );
      }
    }

    const subtotal = cart.items.reduce(
      (acc, item) => acc.add(item.sku.price.mul(item.qty)),
      new Prisma.Decimal(0),
    );

    // --- Coupon -----------------------------------------------------------
    let discount = new Prisma.Decimal(0);
    let appliedCouponId: string | null = null;

    if (input.couponCode) {
      // Pre-validate: date range, minAmount, per-user already-used.
      // Uses `tx` so these reads are part of the same snapshot.
      const { coupon, discountAmount } = await validateCoupon(
        input.couponCode,
        userId,
        subtotal,
        tx,
      );

      // Serialize concurrent checkouts on the same coupon. Other txs block
      // here until we commit; they then re-read the committed count and fail
      // with LIMIT_REACHED if the quota was just consumed.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(abs(hashtext(${coupon.id}))::bigint)`;

      // Definitive count check inside the lock (READ COMMITTED re-reads the
      // now-committed state after the lock is acquired).
      if (coupon.usageLimit !== null) {
        const currentCount = await tx.couponUsage.count({ where: { couponId: coupon.id } });
        if (currentCount >= coupon.usageLimit) {
          throw new AppError(ErrorCodes.COUPON_LIMIT_REACHED, '優惠碼已達使用上限', 422);
        }
      }

      discount = discountAmount;
      appliedCouponId = coupon.id;
    }

    const paymentIntentId = randomUUID();

    const order = await tx.order.create({
      data: {
        userId,
        status: 'PENDING',
        paymentIntentId,
        subtotal,
        discount,
        total: subtotal.sub(discount),
        shippingAddress: input.shippingAddress,
        paymentMethod: input.paymentMethod,
        items: {
          create: cart.items.map((item) => ({
            skuId: item.skuId,
            qty: item.qty,
            unitPrice: item.sku.price,
            skuSnapshot: {
              code: item.sku.code,
              productName: item.sku.product.name,
              optionCombination: item.sku.optionCombination,
            },
          })),
        },
      },
      select: { id: true },
    });

    if (appliedCouponId) {
      try {
        await tx.couponUsage.create({
          data: { couponId: appliedCouponId, userId, orderId: order.id },
        });
      } catch (e) {
        // UNIQUE(coupon_id, user_id) fires when a concurrent checkout for the same
        // user slips past the pre-lock validateCoupon snapshot (both read 0 usages
        // before either commits). Surface as 422 rather than leaking a raw 500.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new AppError(ErrorCodes.COUPON_ALREADY_USED, '您已使用過此優惠碼', 422);
        }
        throw e;
      }
    }

    await tx.paymentMock.create({
      data: {
        orderId: order.id,
        provider: 'mock',
        status: 'PENDING',
        outcomeMode: input.outcomeMode ?? 'AUTO_SUCCESS',
        mockResponse: {},
      },
    });

    // Cascade-deletes all CartItems via FK (cart_items.cart_id ON DELETE CASCADE).
    await tx.cart.delete({ where: { id: cart.id } });

    return { orderId: order.id, paymentIntentId };
  });
}
