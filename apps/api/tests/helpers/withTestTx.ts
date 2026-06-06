import type { Prisma } from '@prisma/client';

import { prisma } from '../../src/lib/db.js';

/** Marker symbol used to force Prisma to roll back the test transaction. */
const ROLLBACK = Symbol.for('vella.test.rollback');

export type TestTx = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Runs `fn` inside a Prisma transaction that is ALWAYS rolled back at the end.
 * This keeps every integration test isolated — no test ever pollutes the DB
 * for subsequent tests or runs.
 *
 *   await withTestTx(async (tx) => {
 *     await tx.$executeRaw`INSERT ...`;
 *     // assertions here
 *   });
 *   // After this line, all writes inside the callback are gone.
 *
 * If `fn` throws, the original error propagates (the rollback is implicit).
 */
export async function withTestTx(fn: (tx: TestTx) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx as TestTx);
      // Forcing a throw is the only Prisma-supported way to rollback an
      // interactive transaction. The catch below converts the marker back to
      // a normal successful return.
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
}
