import { PrismaClient, type OrderStatus } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { prisma, type DbClient } from '../lib/db.js';

import { transitionOrder } from './orderService.js';

/**
 * Resolves the payment outcome for an order identified by paymentIntentId.
 * Called both from the setTimeout in the checkout route (simulated PSP delay)
 * and directly by `POST /webhooks/payment/mock` for idempotency testing.
 *
 * Idempotency: transitionOrder uses a conditional updateMany(WHERE status=current).
 * If the order is already past PENDING, it throws INVALID_STATUS_TRANSITION — we
 * catch that here and return silently (no-op, caller gets 200).
 *
 * MANUAL outcomeMode: skips automatic processing entirely; a human/admin action
 * is expected to drive the transition separately.
 *
 * Accepts an optional DbClient for testability (consistent with other services).
 * When called from the webhook route or setTimeout, no db is passed and the
 * function owns its own transaction. When called from within an existing tx,
 * pass the TransactionClient so the transition participates in the outer tx.
 */
export async function processPaymentOutcome(
  paymentIntentId: string,
  db: DbClient = prisma,
): Promise<void> {
  const order = await db.order.findFirst({
    where: { paymentIntentId },
    include: {
      payments: {
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  });

  if (!order) return;

  const payment = order.payments[0];
  if (!payment) return;

  let toStatus: OrderStatus;
  if (payment.outcomeMode === 'AUTO_SUCCESS') {
    toStatus = 'PAID';
  } else if (payment.outcomeMode === 'AUTO_FAILURE') {
    toStatus = 'CANCELLED';
  } else {
    return;
  }

  try {
    if (db instanceof PrismaClient) {
      await db.$transaction((tx) => transitionOrder(tx, order.id, toStatus, null));
    } else {
      // Already inside a caller-owned tx — join it directly.
      await transitionOrder(db, order.id, toStatus, null);
    }
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCodes.INVALID_STATUS_TRANSITION) {
      return;
    }
    throw err;
  }
}
