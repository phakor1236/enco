import 'dotenv/config';

// bcryptjs is CJS; default-import receives module.exports directly under
// esModuleInterop. The import/default lint rule complains because the
// source has no literal `default` field — silence it for this single line.
// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/db.js';

/**
 * Per-slice seed scaffold. Each phase appends its own seed routine here:
 *   - T1.1  admin / customer demo users + readonly demo accounts  ← added below
 *   - T2.2  categories + products + variants + SKUs
 *   - T4.x  example orders distributed across last 7 days (for dashboard)
 *
 * Idempotency rule: every seed routine must be safe to run multiple times.
 * Use upsert / connectOrCreate. Never assume an empty DB.
 */

const DEMO_PASSWORD = 'demo1234';
const ADMIN_PASSWORD = 'admin1234';
const BCRYPT_ROUNDS = 12;

async function seedUsers(): Promise<void> {
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);

  // Demo customer — readonly so the online demo can't be abused
  await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: { passwordHash: demoHash, role: 'CUSTOMER', isDemoReadonly: true },
    create: {
      email: 'demo@example.com',
      passwordHash: demoHash,
      role: 'CUSTOMER',
      isDemoReadonly: true,
    },
  });

  // Regular admin (customer service tier)
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { passwordHash: adminHash, role: 'ADMIN', isDemoReadonly: true },
    create: {
      email: 'admin@example.com',
      passwordHash: adminHash,
      role: 'ADMIN',
      isDemoReadonly: true,
    },
  });

  // Super admin (full destructive permissions in admin panel)
  await prisma.user.upsert({
    where: { email: 'superadmin@example.com' },
    update: { passwordHash: adminHash, role: 'SUPER_ADMIN', isDemoReadonly: true },
    create: {
      email: 'superadmin@example.com',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      isDemoReadonly: true,
    },
  });
}

async function main(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  await seedUsers();
  // eslint-disable-next-line no-console
  console.log('[seed] ok — users (demo / admin / superadmin) upserted.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
