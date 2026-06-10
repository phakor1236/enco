import { withAdvisoryLock } from '../lib/advisoryLock.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { transitionOrder } from '../services/orderService.js';

import { JOB_KEYS } from './keys.js';

const SHIPPED_TIMEOUT_DAYS = 7;

export async function runAutoCompleteShippedOrders(): Promise<void> {
  await withAdvisoryLock(JOB_KEYS.AUTO_COMPLETE_SHIPPED, async () => {
    const cutoff = new Date(Date.now() - SHIPPED_TIMEOUT_DAYS * 24 * 60 * 60 * 1000);

    const orders = await prisma.order.findMany({
      where: { status: 'SHIPPED', shippedAt: { lt: cutoff } },
      select: { id: true },
    });

    if (orders.length === 0) return;

    logger.info({ count: orders.length }, 'Auto-completing SHIPPED orders older than 7 days');

    for (const { id } of orders) {
      try {
        await prisma.$transaction((tx) => transitionOrder(tx, id, 'COMPLETED', null));
      } catch (err) {
        logger.warn({ orderId: id, err }, 'Failed to auto-complete shipped order — skipping');
      }
    }
  });
}
