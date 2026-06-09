import { randomUUID } from 'node:crypto';

import { Router, type Router as RouterType } from 'express';
import { Prisma, type Coupon } from '@prisma/client';
import { z } from 'zod';
import { ErrorCodes } from '@app/shared';

import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { demoReadonly, requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { withAuditLog } from '../../services/auditLog.js';

export const adminCouponsRouter: RouterType = Router();

const adminGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN')];
const writeGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), demoReadonly];

// ── Body / query schemas ──────────────────────────────────────────────────────

const MoneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'decimal string with at most 2 fraction digits');

const CreateCouponBodySchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'uppercase alphanumeric with _ and -'),
  type: z.enum(['FIXED', 'PERCENT']),
  value: MoneyString,
  minAmount: MoneyString.optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  usageLimit: z.number().int().positive().optional(),
});

const UpdateCouponBodySchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[A-Z0-9_-]+$/)
      .optional(),
    type: z.enum(['FIXED', 'PERCENT']).optional(),
    value: MoneyString.optional(),
    minAmount: MoneyString.nullable().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, 'at least one field is required');

const AdminCouponListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(64).optional(),
});

// ── Mapper ───────────────────────────────────────────────────────────────────

function toDto(c: Coupon) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: c.value.toFixed(2),
    minAmount: c.minAmount?.toFixed(2) ?? null,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    usageLimit: c.usageLimit,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// ── GET /api/admin/coupons ────────────────────────────────────────────────────

adminCouponsRouter.get(
  '/',
  ...adminGuard,
  validateQuery(AdminCouponListQuerySchema),
  async (req, res, next) => {
    try {
      const { limit, cursor } = (
        req as unknown as { validatedQuery: z.infer<typeof AdminCouponListQuerySchema> }
      ).validatedQuery;

      const rows = await prisma.coupon.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | null = null;
      if (rows.length > limit) {
        const overflow = rows.pop();
        nextCursor = overflow?.id ?? null;
      }

      res.json({ items: rows.map(toDto), nextCursor });
    } catch (e) {
      next(e);
    }
  },
);

// ── POST /api/admin/coupons ───────────────────────────────────────────────────

adminCouponsRouter.post(
  '/',
  ...writeGuard,
  validateBody(CreateCouponBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof CreateCouponBodySchema>;
      const id = randomUUID();

      const coupon = await withAuditLog<Coupon>(
        {
          actorId: req.user!.id,
          resourceType: 'coupon',
          resourceId: id,
          action: 'create',
          diff: { code: body.code, type: body.type, value: body.value },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        (tx) => tx.coupon.create({ data: { id, ...body } }),
      );

      res.status(201).json(toDto(coupon));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return next(new AppError(ErrorCodes.VALIDATION_ERROR, 'Coupon code already exists', 409));
      }
      next(e);
    }
  },
);

// ── PATCH /api/admin/coupons/:id ──────────────────────────────────────────────

adminCouponsRouter.patch(
  '/:id',
  ...writeGuard,
  validateBody(UpdateCouponBodySchema),
  async (req, res, next) => {
    try {
      const id = req.params['id'] as string;
      const data = req.body as z.infer<typeof UpdateCouponBodySchema>;

      const before = await prisma.coupon.findUnique({
        where: { id },
        select: { id: true, code: true, type: true, value: true },
      });
      if (!before) throw new AppError(ErrorCodes.COUPON_NOT_FOUND, 'Coupon not found', 404);

      const coupon = await withAuditLog<Coupon>(
        {
          actorId: req.user!.id,
          resourceType: 'coupon',
          resourceId: id,
          action: 'update',
          diff: {
            before: { code: before.code, type: before.type, value: before.value.toFixed(2) },
            after: data,
          },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        (tx) => tx.coupon.update({ where: { id }, data }),
      );

      res.json(toDto(coupon));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return next(new AppError(ErrorCodes.VALIDATION_ERROR, 'Coupon code already exists', 409));
      }
      next(e);
    }
  },
);

// ── DELETE /api/admin/coupons/:id ─────────────────────────────────────────────

adminCouponsRouter.delete('/:id', ...writeGuard, async (req, res, next) => {
  try {
    const id = req.params['id'] as string;

    const coupon = await prisma.coupon.findUnique({
      where: { id },
      select: { id: true, code: true, _count: { select: { usages: true } } },
    });
    if (!coupon) throw new AppError(ErrorCodes.COUPON_NOT_FOUND, 'Coupon not found', 404);
    if (coupon._count.usages > 0) {
      throw new AppError(
        ErrorCodes.COUPON_IN_USE,
        'Cannot delete a coupon that has been used',
        409,
      );
    }

    await withAuditLog<Coupon>(
      {
        actorId: req.user!.id,
        resourceType: 'coupon',
        resourceId: id,
        action: 'delete',
        diff: { code: coupon.code },
        ip: req.ip ?? undefined,
        userAgent: req.get('user-agent') ?? undefined,
      },
      (tx) => tx.coupon.delete({ where: { id } }),
    );

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
