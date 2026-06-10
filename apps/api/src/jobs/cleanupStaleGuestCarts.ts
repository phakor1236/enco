import { withAdvisoryLock } from '../lib/advisoryLock.js';
import { prisma } from '../lib/db.js';
import { logger } from '../lib/logger.js';

import { JOB_KEYS } from './keys.js';

const STALE_DAYS = 7;

export async function runCleanupStaleGuestCarts(): Promise<void> {
  await withAdvisoryLock(JOB_KEYS.CLEANUP_GUEST_CARTS, async () => {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    // CartItem rows are deleted via CASCADE when the Cart is deleted.
    const { count } = await prisma.cart.deleteMany({
      where: { userId: null, updatedAt: { lt: cutoff } },
    });

    if (count > 0) {
      logger.info({ count }, 'Purged stale guest carts');
    }
  });
}
