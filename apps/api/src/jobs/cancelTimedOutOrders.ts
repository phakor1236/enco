import { withAdvisoryLock } from '../lib/advisoryLock.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { transitionOrder } from '../services/orderService.js';

import { JOB_KEYS } from './keys.js';

const TIMEOUT_MINUTES = 30;

export async function runCancelTimedOutOrders(): Promise<void> {
  await withAdvisoryLock(JOB_KEYS.CANCEL_TIMEOUT_ORDERS, async () => {
    const cutoff = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      select: { id: true },
    });

    if (orders.length === 0) return;

    logger.info({ count: orders.length }, 'Cancelling timed-out PENDING orders');

    for (const { id } of orders) {
      try {
        await prisma.$transaction((tx) => transitionOrder(tx, id, 'CANCELLED', null));
      } catch (err) {
        logger.warn({ orderId: id, err }, 'Failed to cancel timed-out order — skipping');
      }
    }
  });
}
