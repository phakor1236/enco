import { type OrderStatus } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/db.js';

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
 */
export async function processPaymentOutcome(paymentIntentId: string): Promise<void> {
  const order = await prisma.order.findFirst({
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
    await prisma.$transaction((tx) => transitionOrder(tx, order.id, toStatus, null));
  } catch (err) {
    if (err instanceof AppError && err.code === ErrorCodes.INVALID_STATUS_TRANSITION) {
      return;
    }
    throw err;
  }
}
