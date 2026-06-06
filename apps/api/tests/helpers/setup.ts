import { execSync } from 'node:child_process';

import 'dotenv/config';

import { prisma } from '../../src/lib/db.js';

/**
 * Vitest globalSetup. Runs once before any test workers spawn.
 *
 * Responsibilities:
 *  1. Repoint DATABASE_URL at TEST_DATABASE_URL so the prisma singleton talks
 *     to the dedicated test database (not the dev DB). Prisma reads the URL
 *     lazily at first connect, so this mutation propagates to workers.
 *  2. Apply migrations to the test DB. Idempotent — re-running with all
 *     migrations already applied is a fast no-op. Without this, integration
 *     tests would error on `relation "users" does not exist`.
 *  3. Provision a tiny `_test_marker` helper table (rollback proof for
 *     withTestTx). Survives across runs; rows do not.
 *  4. Disconnect at teardown so vitest exits cleanly.
 */
export default async function (): Promise<() => Promise<void>> {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set; ensure apps/api/.env defines it');
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  // Apply all pending migrations to the test DB. `prisma migrate deploy` is
  // idempotent: with everything applied it exits 0 in ~150ms.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: new URL('../../', import.meta.url),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS _test_marker (
      id   SERIAL PRIMARY KEY,
      note TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`TRUNCATE _test_marker RESTART IDENTITY`);

  return async () => {
    await prisma.$disconnect();
  };
}
