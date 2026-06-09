import { Router, type Router as RouterType } from 'express';
import type { Prisma } from '@prisma/client';
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
const superWriteGuard = [requireAuth, requireRole('SUPER_ADMIN'), demoReadonly];

// ── Query / body schemas ──────────────────────────────────────────────────────

// Offset-based pagination (not cursor): admin views are paged tables, not
// infinite-scroll, and cursor + status filter can silently skip/repeat rows
// when order status changes between page fetches.
const AdminOrderListQuerySchema = z.object({
  status: z.enum(['PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
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
      const { status, page, pageSize } = (
        req as unknown as { validatedQuery: z.infer<typeof AdminOrderListQuerySchema> }
      ).validatedQuery;

      const where = status ? { status } : {};
      const [rows, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
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
        }),
        prisma.order.count({ where }),
      ]);

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
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
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
      const toStatus = 'SHIPPED' as const;

      // diffPayload is populated inside coreLogic (after the tx reads the live
      // status) so the audit record reflects what the DB held at transition time,
      // not a pre-tx snapshot that may be stale under concurrent writes.
      const diffPayload: Record<string, unknown> = {};
      await withAuditLog<void>(
        {
          actorId: actor.id,
          resourceType: 'order',
          resourceId: orderId,
          action: 'ship',
          diff: diffPayload as Prisma.InputJsonObject,
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, 'Order not found', 404);
          diffPayload['before'] = { status: order.status };
          diffPayload['after'] = { status: toStatus };
          await transitionOrder(tx, orderId, toStatus, actor, {
            note,
            shipment: { carrier, trackingNo },
          });
        },
      );

      res.json({ orderId, status: toStatus });
    } catch (e) {
      next(e);
    }
  },
);

// ── POST /api/admin/orders/:id/refund ─────────────────────────────────────────

adminOrdersRouter.post(
  '/:id/refund',
  ...superWriteGuard,
  validateBody(RefundBodySchema),
  async (req, res, next) => {
    try {
      const orderId = req.params['id'] as string;
      const { note } = req.body as z.infer<typeof RefundBodySchema>;
      const actor = { id: req.user!.id, role: req.user!.role };
      const toStatus = 'REFUNDED' as const;

      const diffPayload: Record<string, unknown> = {};
      await withAuditLog<void>(
        {
          actorId: actor.id,
          resourceType: 'order',
          resourceId: orderId,
          action: 'refund',
          diff: diffPayload as Prisma.InputJsonObject,
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          });
          if (!order) throw new AppError(ErrorCodes.ORDER_NOT_FOUND, 'Order not found', 404);
          diffPayload['before'] = { status: order.status };
          diffPayload['after'] = { status: toStatus };
          await transitionOrder(tx, orderId, toStatus, actor, { note });
        },
      );

      res.json({ orderId, status: toStatus });
    } catch (e) {
      next(e);
    }
  },
);
