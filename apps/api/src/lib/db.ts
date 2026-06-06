import { PrismaClient } from '@prisma/client';

/**
 * Single shared PrismaClient instance. Avoids exhausting the connection pool
 * during dev hot-reload (where re-importing would otherwise spawn new clients).
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}
