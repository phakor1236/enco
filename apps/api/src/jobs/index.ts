import cron, { type ScheduledTask } from 'node-cron';

import { logger } from '../lib/logger.js';

import { runAutoCompleteShippedOrders } from './autoCompleteShippedOrders.js';
import { runCancelTimedOutOrders } from './cancelTimedOutOrders.js';
import { runCleanupRefreshTokens } from './cleanupRefreshTokens.js';
import { runCleanupStaleGuestCarts } from './cleanupStaleGuestCarts.js';

export { JOB_KEYS } from './keys.js';

/**
 * Register all background cron jobs.
 * Called once at startup from index.ts; skipped in the test environment so
 * cron timers never leak into the test process.
 * Returns task handles so the caller can stop them on SIGTERM.
 */
export function registerJobs(): ScheduledTask[] {
  if (process.env.NODE_ENV === 'test') return [];

  const tasks: ScheduledTask[] = [];

  // T7.2 — Cancel PENDING orders older than 30 min (every 5 minutes)
  tasks.push(
    cron.schedule('*/5 * * * *', () => {
      runCancelTimedOutOrders().catch((err) =>
        logger.error({ err, job: 'cancelTimedOutOrders' }, 'Cron job failed'),
      );
    }),
  );

  // T7.3 — Auto-complete SHIPPED orders older than 7 days (daily at 02:00)
  tasks.push(
    cron.schedule('0 2 * * *', () => {
      runAutoCompleteShippedOrders().catch((err) =>
        logger.error({ err, job: 'autoCompleteShippedOrders' }, 'Cron job failed'),
      );
    }),
  );

  // T7.4 — Purge expired/revoked refresh tokens (daily at 03:00)
  tasks.push(
    cron.schedule('0 3 * * *', () => {
      runCleanupRefreshTokens().catch((err) =>
        logger.error({ err, job: 'cleanupRefreshTokens' }, 'Cron job failed'),
      );
    }),
  );

  // T7.5 — Delete stale guest carts older than 7 days (daily at 03:30)
  tasks.push(
    cron.schedule('30 3 * * *', () => {
      runCleanupStaleGuestCarts().catch((err) =>
        logger.error({ err, job: 'cleanupStaleGuestCarts' }, 'Cron job failed'),
      );
    }),
  );

  // T7.6 — Reset demo DB every 6 hours (production + RESET_DEMO_DB=true only)
  if (process.env.NODE_ENV === 'production' && process.env.RESET_DEMO_DB === 'true') {
    tasks.push(
      cron.schedule('0 */6 * * *', () => {
        import('./resetDemoDb.js')
          .then(({ runResetDemoDb }) => runResetDemoDb())
          .catch((err) => logger.error({ err, job: 'resetDemoDb' }, 'Cron job failed'));
      }),
    );
  }

  logger.info({ count: tasks.length }, 'Background jobs registered');
  return tasks;
}
