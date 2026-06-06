import type { Prisma } from '@prisma/client';
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

/**
 * Service-layer handle that accepts either the base PrismaClient or a
 * TransactionClient. Services use this so callers can pass `prisma` for
 * single-shot ops or a `tx` from `prisma.$transaction(...)` for atomic
 * multi-step flows (checkout, cart merge, refresh rotation). Centralized
 * here so every service imports the same type.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;
