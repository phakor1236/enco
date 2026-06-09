import { Prisma } from '@prisma/client';

import { prisma } from '../lib/db.js';

// Fields that must never appear in the diff payload (SPEC.md §5).
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
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !DENY_LIST.has(k)));
}

/**
 * HOF that wraps an admin write operation in a Prisma transaction, appending
 * an AdminActionLog row in the same transaction. A throw from `coreLogic`
 * rolls back both the business change and the audit row atomically.
 *
 * Usage:
 *   const product = await withAuditLog(
 *     { actorId, resourceType: 'product', resourceId: id, action: 'update', diff },
 *     (tx) => tx.product.update({ where: { id }, data }),
 *   );
 */
export async function withAuditLog<T>(
  ctx: AuditContext,
  coreLogic: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await coreLogic(tx);

    const safeDiff = ctx.diff ? stripDenyList(ctx.diff) : null;

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
