import { Prisma } from '@prisma/client';

import { prisma } from '../lib/db.js';

// Fields that must never appear in the diff payload (SPEC.md §5).
// ip/user_agent/userAgent are denied from the diff JSON blob but ARE recorded
// as explicit columns (ctx.ip / ctx.userAgent) on the log row.
const DENY_LIST = new Set([
  'password_hash',
  'passwordHash',
  'token_hash',
  'tokenHash',
  'refresh_token',
  'refreshToken',
  'ip',
  'user_agent',
  'userAgent',
]);

export interface AuditContext {
  actorId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  diff?: Prisma.InputJsonObject;
  ip?: string;
  userAgent?: string;
}

function stripDenyList(obj: Prisma.InputJsonObject): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k]) => !DENY_LIST.has(k))
      .map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v)
          ? stripDenyList(v as Prisma.InputJsonObject)
          : v,
      ]),
  );
}

/**
 * HOF that wraps an admin write operation in a Prisma transaction, appending
 * an AdminActionLog row in the same transaction. A throw from `coreLogic`
 * rolls back both the business change and the audit row atomically.
 *
 * IMPORTANT: If the AdminActionLog write fails (e.g., invalid actorId FK),
 * the entire transaction rolls back — the business operation does NOT commit.
 * Callers must ensure actorId references an existing user.
 *
 * Usage:
 *   const product = await withAuditLog(
 *     { actorId, resourceType: 'product', resourceId: id, action: 'update', diff },
 *     (tx) => tx.product.update({ where: { id }, data }),
 *   );
 */
export async function withAuditLog<T>(
  ctx: AuditContext,
  coreLogic: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await coreLogic(tx);

    const stripped = ctx.diff ? stripDenyList(ctx.diff) : null;
    // Write null when all keys were deny-listed — an empty {} and null have
    // different semantics for downstream "find logs with meaningful diff" queries.
    const safeDiff = stripped && Object.keys(stripped).length > 0 ? stripped : null;

    await tx.adminActionLog.create({
      data: {
        actorId: ctx.actorId,
        resourceType: ctx.resourceType,
        resourceId: ctx.resourceId,
        action: ctx.action,
        diff: safeDiff ?? undefined,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });

    return result;
  });
}
