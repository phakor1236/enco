import 'dotenv/config';

import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/lib/db.js';

describe('Prisma client (db.ts singleton)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('exposes the singleton PrismaClient with $queryRaw', () => {
    expect(typeof prisma.$queryRaw).toBe('function');
    expect(typeof prisma.$transaction).toBe('function');
  });

  it('connects to the database and returns SELECT 1', async () => {
    const rows = await prisma.$queryRaw<Array<{ one: number }>>`SELECT 1 as one`;
    expect(rows).toEqual([{ one: 1 }]);
  });
});
