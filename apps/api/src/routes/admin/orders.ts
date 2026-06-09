import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { ErrorCodes } from '@app/shared';

import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { demoReadonly, requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { withAuditLog } from '../../services/auditLog.js';
import { transitionOrder } from '../../services/orderService.js';

export const adminOrdersRouter: RouterType = Router();

const adminGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN')];
const writeGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), demoReadonly];

// ── Query / body schemas ──────────────────────────────────────────────────────

const AdminOrderListQuerySchema = z.object({
  status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(64).optional(),
});

const ShipBodySchema = z.object({
  carrier: z.string().min(1).max(80).optional(),
  trackingNo: z.string().min(1).max(120).optional(),
  note: z.string().max(500).optional(),
});

const RefundBodySchema = z.object({
  note: z.string().max(500).optional(),
});

// ── GET /api/admin/orders ─────────────────────────────────────────────────────

adminOrdersRouter.get(
  '/',
  ...adminGuard,
  validateQuery(AdminOrderListQuerySchema),
  async (req, res, next) => {
    try {
      const { status, limit, cursor } = (
        req as unknown as { validatedQuery: z.infer<typeof AdminOrderListQuerySchema> }
      ).validatedQuery;

      const rows = await prisma.order.findMany({
        where: status ? { status } : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          userId: true,
          status: true,
          subtotal: true,
          discount: true,
          shippingFee: true,
          total: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      });

      let nextCursor: string | null = null;
      if (rows.length > limit) {
        const overflow = rows.pop();
        nextCursor = overflow?.id ?? null;
      }

      res.json({
        items: rows.map((o) => ({
          id: o.id,
          userId: o.userId,
          status: o.status,
          subtotal: o.subtotal,
          discount: o.discount,
          shippingFee: o.shippingFee,
          total: o.total,
          createdAt: o.createdAt,
          itemCount: o._count.items,
        })),
        nextCursor,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── GET /api/admin/orders/:id ─────────────────────────────────────────────────

adminOrdersRouter.get('/:id', ...adminGuard, async (req, res, next) => {
  try {
    const id = req.params['id'] as string;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        logs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, 'Order not found', 404);

    res.json({
      id: order.id,
      userId: order.userId,
      status: order.status,
      paymentIntentId: order.paymentIntentId,
      subtotal: order.subtotal,
      discount: order.discount,
      shippingFee: order.shippingFee,
      total: order.total,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      shippedAt: order.shippedAt,
      items: order.items.map((item) => ({
        skuId: item.skuId,
        qty: item.qty,
        unitPrice: item.unitPrice,
        skuSnapshot: item.skuSnapshot,
      })),
      paymentStatus: order.payments[0]?.status ?? null,
      shipment: order.shipments[0]
        ? {
            carrier: order.shipments[0].carrier,
            trackingNo: order.shipments[0].trackingNo,
          }
        : null,
      statusLogs: order.logs.map((l) => ({
        fromStatus: l.fromStatus,
        toStatus: l.toStatus,
        operatorId: l.operatorId,
        note: l.note,
        createdAt: l.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/admin/orders/:id/ship ──────────────────────────────────────────

adminOrdersRouter.post(
  '/:id/ship',
  ...writeGuard,
  validateBody(ShipBodySchema),
  async (req, res, next) => {
    try {
      const orderId = req.params['id'] as string;
      const { carrier, trackingNo, note } = req.body as z.infer<typeof ShipBodySchema>;
      const actor = { id: req.user!.id, role: req.user!.role };

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, 'Order not found', 404);

      await withAuditLog(
        {
          actorId: actor.id,
          resourceType: 'order',
          resourceId: orderId,
          action: 'ship',
          diff: { before: { status: order.status }, after: { status: 'SHIPPED' } },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        (tx) =>
          transitionOrder(tx, orderId, 'SHIPPED', actor, {
            note,
            shipment: { carrier, trackingNo },
          }),
      );

      res.json({ orderId, status: 'SHIPPED' });
    } catch (e) {
      next(e);
    }
  },
);

// ── POST /api/admin/orders/:id/refund ─────────────────────────────────────────

adminOrdersRouter.post(
  '/:id/refund',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  demoReadonly,
  validateBody(RefundBodySchema),
  async (req, res, next) => {
    try {
      const orderId = req.params['id'] as string;
      const { note } = req.body as z.infer<typeof RefundBodySchema>;
      const actor = { id: req.user!.id, role: req.user!.role };

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, 'Order not found', 404);

      await withAuditLog(
        {
          actorId: actor.id,
          resourceType: 'order',
          resourceId: orderId,
          action: 'refund',
          diff: { before: { status: order.status }, after: { status: 'REFUNDED' } },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        (tx) => transitionOrder(tx, orderId, 'REFUNDED', actor, { note }),
      );

      res.json({ orderId, status: 'REFUNDED' });
    } catch (e) {
      next(e);
    }
  },
);
