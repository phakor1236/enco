import { randomUUID } from 'node:crypto';

import { OrderStatus, Prisma, type Role } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { type DbClient } from '../lib/db.js';

/**
 * Order state machine (SPEC §5):
 *
 *   PENDING   → PAID, CANCELLED
 *   PAID      → SHIPPED, REFUNDED              (no CANCELLED — must REFUND)
 *   SHIPPED   → COMPLETED, REFUNDED
 *   COMPLETED → REFUNDED
 *   CANCELLED → (terminal)
 *   REFUNDED  → (terminal)
 *
 * Anything not in this table throws 409 INVALID_STATUS_TRANSITION.
 *
 * `transitionOrder` MUST be called inside an outer `prisma.$transaction`.
 * The state change, OrderStatusLog insert, and side-effects (restock,
 * ShipmentMock create, PaymentMock create) all share that tx so the audit
 * log can never disagree with Order.status. Same convention as
 * `rotateRefreshToken` and `mergeGuestCart`.
 */

export interface TransitionActor {
  id: string;
  role: Role;
}

export interface TransitionCtx {
  /** Free-text reason persisted on OrderStatusLog. Audit / debugging hint. */
  note?: string;
  /** Optional override for the ShipmentMock created on PAID → SHIPPED. */
  shipment?: { carrier?: string; trackingNo?: string };
  /** Mock provider response saved on the REFUNDED PaymentMock row. */
  refund?: { mockResponse?: Prisma.InputJsonValue };
}

const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['SHIPPED', 'REFUNDED'],
  SHIPPED: ['COMPLETED', 'REFUNDED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Service-level role gate, defense-in-depth on top of route `requireRole`.
 * System-driven callers (cron, payment webhook) pass `actor = null` and
 * bypass — those entry points are gated by transport (the webhook URL is
 * never user-facing; cron has no HTTP entry at all).
 */
function assertActorAllowed(to: OrderStatus, actor: TransitionActor | null): void {
  if (actor === null) return;
  if (to === 'SHIPPED' && actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only ADMIN may ship orders', 403);
  }
  if (to === 'REFUNDED' && actor.role !== 'SUPER_ADMIN') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only SUPER_ADMIN may refund orders', 403);
  }
}

export async function transitionOrder(
  tx: DbClient,
  orderId: string,
  toStatus: OrderStatus,
  actor: TransitionActor | null,
  ctx: TransitionCtx = {},
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { select: { skuId: true, qty: true } } },
  });
  if (!order) {
    throw new AppError(ErrorCodes.ORDER_NOT_FOUND, '找不到此訂單', 404);
  }

  if (!ALLOWED[order.status].includes(toStatus)) {
    throw new AppError(
      ErrorCodes.INVALID_STATUS_TRANSITION,
      `訂單無法從 ${order.status} 轉至 ${toStatus}`,
      409,
      { from: order.status, to: toStatus },
    );
  }
  assertActorAllowed(toStatus, actor);

  const now = new Date();
  const update: Prisma.OrderUpdateInput = { status: toStatus };

  switch (toStatus) {
    case 'PAID':
      update.paidAt = now;
      break;
    case 'CANCELLED':
      await restock(tx, order.items);
      break;
    case 'SHIPPED':
      update.shippedAt = now;
      await tx.shipmentMock.create({
        data: {
          orderId: order.id,
          carrier: ctx.shipment?.carrier ?? 'MOCK_CARRIER',
          trackingNo: ctx.shipment?.trackingNo ?? `MOCK-${randomUUID()}`,
        },
      });
      break;
    case 'COMPLETED':
      // No side-effects: SHIPPED→COMPLETED is just a state acknowledgement.
      break;
    case 'REFUNDED':
      await restock(tx, order.items);
      await tx.paymentMock.create({
        data: {
          orderId: order.id,
          provider: 'mock',
          status: 'REFUNDED',
          // Refunds are always triggered by a human / system action, never
          // by an outcome_mode timer — record MANUAL so reports can tell
          // the refund row apart from the original auto-charged payment.
          outcomeMode: 'MANUAL',
          mockResponse: (ctx.refund?.mockResponse ?? {}) as Prisma.InputJsonValue,
        },
      });
      break;
    case 'PENDING':
      // Nothing valid transitions TO PENDING (it's the initial state set on
      // checkout INSERT). Allowed[] enforces this; switch arm exists only so
      // exhaustive-check passes.
      throw new AppError(ErrorCodes.INVALID_STATUS_TRANSITION, '不能將訂單回退至 PENDING', 409);
  }

  const updated = await tx.order.updateMany({
    where: { id: orderId, status: order.status },
    data: update,
  });
  if (updated.count === 0) {
    throw new AppError(
      ErrorCodes.INVALID_STATUS_TRANSITION,
      '訂單狀態已被其他 tx 變更，請重新讀取',
      409,
      { expected: order.status },
    );
  }
  await tx.orderStatusLog.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus,
      operatorId: actor?.id ?? null,
      note: ctx.note ?? null,
    },
  });
}

/**
 * Bulk-bump SKU stock back for every line on a cancelled or refunded order.
 * Sequential inside the tx — same reasoning as cartService.mergeGuestCart's
 * for-loop (single tx connection, parallel writes can deadlock on the same
 * row when two orders share a SKU). Order line counts are small.
 */
async function restock(
  tx: DbClient,
  items: readonly { skuId: string; qty: number }[],
): Promise<void> {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await tx.sku.update({
      where: { id: item.skuId },
      data: { stock: { increment: item.qty } },
    });
  }
}
