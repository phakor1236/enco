import cron from 'node-cron';

import { logger } from '../lib/logger.js';

/**
 * Stable numeric keys for each cron job. These are the advisory lock keys
 * used to prevent duplicate execution across multiple API instances.
 * Never reuse a key once assigned.
 */
export const JOB_KEYS = {
  CANCEL_TIMEOUT_ORDERS: 1001,
  AUTO_COMPLETE_SHIPPED: 1002,
  CLEANUP_REFRESH_TOKENS: 1003,
  CLEANUP_GUEST_CARTS: 1004,
  RESET_DEMO_DB: 1005,
} as const;

/**
 * Register all background cron jobs.
 * Called once at startup from index.ts; skipped in the test environment so
 * cron timers never leak into the test process.
 */
export function registerJobs(): void {
  if (process.env.NODE_ENV === 'test') return;

  // T7.2 — Cancel PENDING orders older than 30 min (every 5 minutes)
  cron.schedule('*/5 * * * *', () => {
    void import('./cancelTimedOutOrders.js').then(({ runCancelTimedOutOrders }) =>
      runCancelTimedOutOrders(),
    );
  });

  // T7.3 — Auto-complete SHIPPED orders older than 7 days (daily at 02:00)
  cron.schedule('0 2 * * *', () => {
    void import('./autoCompleteShippedOrders.js').then(({ runAutoCompleteShippedOrders }) =>
      runAutoCompleteShippedOrders(),
    );
  });

  // T7.4 — Purge expired/revoked refresh tokens (daily at 03:00)
  cron.schedule('0 3 * * *', () => {
    void import('./cleanupRefreshTokens.js').then(({ runCleanupRefreshTokens }) =>
      runCleanupRefreshTokens(),
    );
  });

  // T7.5 — Delete stale guest carts older than 7 days (daily at 03:30)
  cron.schedule('30 3 * * *', () => {
    void import('./cleanupStaleGuestCarts.js').then(({ runCleanupStaleGuestCarts }) =>
      runCleanupStaleGuestCarts(),
    );
  });

  // T7.6 — Reset demo DB every 6 hours (production + RESET_DEMO_DB=true only)
  if (process.env.NODE_ENV === 'production' && process.env.RESET_DEMO_DB === 'true') {
    cron.schedule('0 */6 * * *', () => {
      void import('./resetDemoDb.js').then(({ runResetDemoDb }) => runResetDemoDb());
    });
  }

  logger.info('Background jobs registered');
}
