import 'dotenv/config';

import { prisma } from '../src/lib/db.js';

/**
 * Per-slice seed scaffold. Each phase appends its own seed routine here:
 *   - T1.1  admin / customer demo users + readonly demo accounts
 *   - T2.2  categories + products + variants + SKUs
 *   - T4.x  example orders distributed across last 7 days (for dashboard)
 *
 * Idempotency rule: every seed routine must be safe to run multiple times.
 * Use upsert / connectOrCreate. Never assume an empty DB.
 */
async function main(): Promise<void> {
  // Sanity check that connectivity + auth + DB exist
  await prisma.$queryRaw`SELECT 1`;

  // === Per-phase routines will be appended below ============================
  // await seedUsers();
  // await seedCatalog();
  // await seedOrders();
  // ==========================================================================

  // eslint-disable-next-line no-console
  console.log('[seed] ok — no per-phase routines registered yet (T0.6 scaffold).');
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
