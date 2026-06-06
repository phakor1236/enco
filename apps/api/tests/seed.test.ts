import { execSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/db.js';

/**
 * Seed is idempotent: running it twice must leave the same 3 demo users
 * (demo / admin / superadmin) — never duplicates, never deletes.
 *
 * NOTE: this test wipes + re-seeds users on the TEST_DATABASE_URL DB.
 * Done outside withTestTx because we're literally invoking the seed
 * script as a subprocess (which opens its own DB connection).
 */
const SEED_EMAILS = ['demo@example.com', 'admin@example.com', 'superadmin@example.com'];

function runSeed(): void {
  execSync('pnpm exec tsx prisma/seed.ts', {
    cwd: new URL('../', import.meta.url),
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}

describe('pnpm db:seed', () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: SEED_EMAILS } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: SEED_EMAILS } } });
    await prisma.$disconnect();
  });

  it('creates demo / admin / superadmin on first run', async () => {
    runSeed();

    const users = await prisma.user.findMany({
      where: { email: { in: SEED_EMAILS } },
      orderBy: { email: 'asc' },
      select: { email: true, role: true, isDemoReadonly: true },
    });

    expect(users).toEqual([
      { email: 'admin@example.com', role: 'ADMIN', isDemoReadonly: true },
      { email: 'demo@example.com', role: 'CUSTOMER', isDemoReadonly: true },
      // superadmin is writable per SPEC §11.5 — 6h cron reset bounds abuse
      { email: 'superadmin@example.com', role: 'SUPER_ADMIN', isDemoReadonly: false },
    ]);
  });

  it('is idempotent — second run leaves the same 3 rows', async () => {
    runSeed();
    runSeed();

    const count = await prisma.user.count({ where: { email: { in: SEED_EMAILS } } });
    expect(count).toBe(3);
  });
});
