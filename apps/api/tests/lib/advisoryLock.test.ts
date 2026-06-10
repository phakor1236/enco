import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { withAdvisoryLock } from '../../src/lib/advisoryLock.js';

/**
 * Tests the PostgreSQL session-level advisory lock behaviour.
 *
 * Two separate PrismaClient instances simulate two distinct processes (each
 * with its own connection pool and DB sessions). Advisory locks are
 * session-scoped, so the instances contend correctly at the DB level.
 */

const LOCK_KEY_BASE = 77001; // Unique range to avoid collisions with other test suites

type LockRow = { acquired: boolean };

describe('pg advisory lock — two sessions', () => {
  it('session 1 acquires, session 2 is blocked, session 1 releases, session 2 then acquires', async () => {
    const KEY = LOCK_KEY_BASE;
    const db1 = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
    const db2 = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

    try {
      // Session 1 acquires the lock.
      const rows1 = await db1.$queryRaw<LockRow[]>`
        SELECT pg_try_advisory_lock(${KEY}::bigint) AS acquired
      `;
      expect(rows1[0]?.acquired).toBe(true);

      // Session 2 tries the same key — lock is held by session 1, must fail.
      const rows2 = await db2.$queryRaw<LockRow[]>`
        SELECT pg_try_advisory_lock(${KEY}::bigint) AS acquired
      `;
      expect(rows2[0]?.acquired).toBe(false);

      // Session 1 releases.
      await db1.$queryRaw`SELECT pg_advisory_unlock(${KEY}::bigint)`;

      // Session 2 can now acquire.
      const rows3 = await db2.$queryRaw<LockRow[]>`
        SELECT pg_try_advisory_lock(${KEY}::bigint) AS acquired
      `;
      expect(rows3[0]?.acquired).toBe(true);

      await db2.$queryRaw`SELECT pg_advisory_unlock(${KEY}::bigint)`;
    } finally {
      await db1.$disconnect();
      await db2.$disconnect();
    }
  });
});

describe('withAdvisoryLock wrapper', () => {
  it('runs fn and returns its result when lock is free', async () => {
    const result = await withAdvisoryLock(LOCK_KEY_BASE + 1, async () => 'hello');
    expect(result).toBe('hello');
  });

  it('returns null when lock is already held by another session', async () => {
    const KEY = LOCK_KEY_BASE + 2;
    const external = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

    // External session holds the lock.
    await external.$queryRaw<LockRow[]>`SELECT pg_try_advisory_lock(${KEY}::bigint) AS acquired`;

    try {
      // withAdvisoryLock uses the main prisma singleton (different session from external).
      const result = await withAdvisoryLock(KEY, async () => 'should-not-run');
      expect(result).toBeNull();
    } finally {
      await external.$queryRaw`SELECT pg_advisory_unlock(${KEY}::bigint)`;
      await external.$disconnect();
    }
  });

  it('releases the lock even if fn throws', async () => {
    const KEY = LOCK_KEY_BASE + 3;

    await expect(
      withAdvisoryLock(KEY, async () => {
        throw new Error('job failed');
      }),
    ).rejects.toThrow('job failed');

    // Lock must be released — a subsequent call with the same key must succeed.
    const result = await withAdvisoryLock(KEY, async () => 'recovered');
    expect(result).toBe('recovered');
  });
});
