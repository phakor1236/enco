import { Router, type Router as RouterType } from 'express';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';

export const ordersRouter: RouterType = Router();

ordersRouter.use(requireAuth);

/**
 * GET /orders  — authenticated user's order list, newest first.
 * Query: ?page=1&pageSize=10 (clamped: min 1, max 50).
 */
ordersRouter.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt((req.query.page as string) ?? '1', 10) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number.parseInt((req.query.pageSize as string) ?? '10', 10) || 10),
    );
    const skip = (page - 1) * pageSize;

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { _count: { select: { items: true } } },
      }),
      prisma.order.count({ where: { userId: req.user!.id } }),
    ]);

    res.json({
      items: orders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total,
        createdAt: o.createdAt,
        itemCount: o._count.items,
      })),
      total,
      page,
      pageSize,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /orders/:id  — full order detail.
 * Returns 404 if not found OR if the order belongs to a different user
 * (avoid leaking that the order exists at all).
 */
ordersRouter.get('/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!order || order.userId !== req.user!.id) {
      throw new AppError(ErrorCodes.ORDER_NOT_FOUND, '找不到此訂單', 404);
    }

    res.json({
      id: order.id,
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
      items: order.items,
      paymentStatus: order.payments[0]?.status ?? null,
    });
  } catch (e) {
    next(e);
  }
});
