import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/db.js';

import { withTestTx } from './helpers/withTestTx.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('withTestTx — transactional rollback helper', () => {
  it('runs the callback and rolls back all writes when it returns normally', async () => {
    await withTestTx(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO _test_marker (note) VALUES ('inserted-by-test')`);
      const inside = await tx.$queryRawUnsafe<Array<{ note: string }>>(
        `SELECT note FROM _test_marker`,
      );
      expect(inside).toEqual([{ note: 'inserted-by-test' }]);
    });

    const outside = await prisma.$queryRawUnsafe<Array<{ note: string }>>(
      `SELECT note FROM _test_marker`,
    );
    expect(outside).toEqual([]);
  });

  it('still rolls back when the callback throws (and rethrows the error)', async () => {
    await expect(
      withTestTx(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO _test_marker (note) VALUES ('will-be-rolled-back')`,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const outside = await prisma.$queryRawUnsafe<Array<{ note: string }>>(
      `SELECT note FROM _test_marker`,
    );
    expect(outside).toEqual([]);
  });

  it('survives multiple sequential runs without state leakage', async () => {
    for (let i = 0; i < 3; i += 1) {
      await withTestTx(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO _test_marker (note) VALUES ('run-${i}')`);
      });
    }
    const outside = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM _test_marker`);
    expect(outside).toEqual([]);
  });
});
