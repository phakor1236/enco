import 'dotenv/config';

import { prisma } from '../../src/lib/db.js';

/**
 * Vitest globalSetup. Runs once before all tests.
 *
 * Responsibilities:
 *  1. Repoint DATABASE_URL at TEST_DATABASE_URL so the prisma singleton talks
 *     to the dedicated test database (not the dev DB).
 *  2. Provision a small `_test_marker` helper table used to *prove* that
 *     withTestTx rollbacks work end-to-end (the table itself survives across
 *     tests; its rows do not).
 *  3. Disconnect at teardown so vitest exits cleanly.
 */
export default async function (): Promise<() => Promise<void>> {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set; ensure apps/api/.env defines it');
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

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
