import { prisma } from './db.js';

type LockRow = { acquired: boolean };

/**
 * Tries to acquire a PostgreSQL session-level advisory lock (non-blocking).
 * Returns null if the lock is already held by another session.
 * The fn() result is returned if the lock is acquired.
 *
 * Advisory locks are session-scoped. In a single-process cron context the pool
 * is idle between job runs, so acquire and release reliably land on the same
 * connection. In a multi-process setup each process has its own pool and DB
 * sessions — concurrent instances contend correctly at the DB level.
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T | null> {
  const rows = await prisma.$queryRaw<LockRow[]>`
    SELECT pg_try_advisory_lock(${key}::bigint) AS acquired
  `;
  if (!rows[0]?.acquired) return null;
  try {
    return await fn();
  } finally {
    await prisma.$queryRaw<unknown[]>`SELECT pg_advisory_unlock(${key}::bigint)`;
  }
}
