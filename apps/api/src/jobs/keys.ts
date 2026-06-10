/**
 * Stable numeric advisory-lock keys for each cron job.
 * Never reuse a key once assigned — existing rows in advisory-lock
 * wait queues reference these values.
 */
export const JOB_KEYS = {
  CANCEL_TIMEOUT_ORDERS: 1001,
  AUTO_COMPLETE_SHIPPED: 1002,
  CLEANUP_REFRESH_TOKENS: 1003,
  CLEANUP_GUEST_CARTS: 1004,
  RESET_DEMO_DB: 1005,
} as const;
