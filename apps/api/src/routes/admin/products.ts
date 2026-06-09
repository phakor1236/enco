import { randomUUID } from 'node:crypto';

import { Router, type Router as RouterType } from 'express';
import type { Prisma, Product, Sku } from '@prisma/client';
import { z } from 'zod';
import { ErrorCodes } from '@app/shared';

import { prisma } from '../../lib/db.js';
import { AppError } from '../../lib/errors.js';
import { demoReadonly, requireAuth, requireRole } from '../../middleware/auth.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { withAuditLog } from '../../services/auditLog.js';

export const adminProductsRouter: RouterType = Router();
export const adminSkusRouter: RouterType = Router();

// All admin routes require ADMIN or SUPER_ADMIN; writes also block demo accounts.
const adminGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN')];
const writeGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), demoReadonly];

// ── Body / query schemas ──────────────────────────────────────────────────────

const MoneyString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'decimal string with at most 2 fraction digits');

const CreateProductBodySchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(5000).default(''),
  categoryId: z.string().min(1),
  basePrice: MoneyString,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
});

const UpdateProductBodySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    slug: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    description: z.string().max(5000).optional(),
    categoryId: z.string().min(1).optional(),
    basePrice: MoneyString.optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, 'at least one field is required');

const AdminProductListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(64).optional(),
});

const AdjustStockBodySchema = z.object({
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'delta must be nonzero'),
});

// ── Mapper ───────────────────────────────────────────────────────────────────

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  basePrice: { toFixed(n: number): string };
  status: string;
  categoryId: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(p: ProductRow) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    basePrice: p.basePrice.toFixed(2),
    status: p.status,
    categoryId: p.categoryId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ── GET /api/admin/products ───────────────────────────────────────────────────

adminProductsRouter.get(
  '/',
  ...adminGuard,
  validateQuery(AdminProductListQuerySchema),
  async (req, res, next) => {
    try {
      const { status, limit, cursor } = (
        req as unknown as { validatedQuery: z.infer<typeof AdminProductListQuerySchema> }
      ).validatedQuery;

      const rows = await prisma.product.findMany({
        where: status ? { status } : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          basePrice: true,
          status: true,
          categoryId: true,
          createdAt: true,
          updatedAt: true,
        },
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

// ── POST /api/admin/products ──────────────────────────────────────────────────

adminProductsRouter.post(
  '/',
  ...writeGuard,
  validateBody(CreateProductBodySchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof CreateProductBodySchema>;
      // Pre-generate id so the audit log can reference it in the same tx.
      const id = randomUUID();

      const product = await withAuditLog<Product>(
        {
          actorId: req.user!.id,
          resourceType: 'product',
          resourceId: id,
          action: 'create',
          diff: { name: body.name, slug: body.slug, status: body.status },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        (tx) => tx.product.create({ data: { id, ...body } }),
      );

      res.status(201).json(toDto(product));
    } catch (e) {
      next(e);
    }
  },
);

// ── PATCH /api/admin/products/:id ─────────────────────────────────────────────

adminProductsRouter.patch(
  '/:id',
  ...writeGuard,
  validateBody(UpdateProductBodySchema),
  async (req, res, next) => {
    try {
      // Spread middleware widens req.params to Record<string,string|string[]|undefined>;
      // cast to string — the route pattern guarantees it is always a string.
      const id = req.params['id'] as string;
      const data = req.body as z.infer<typeof UpdateProductBodySchema>;

      const before = await prisma.product.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, status: true, basePrice: true },
      });
      if (!before) throw new AppError(ErrorCodes.PRODUCT_NOT_FOUND, 'Product not found', 404);

      const product = await withAuditLog<Product>(
        {
          actorId: req.user!.id,
          resourceType: 'product',
          resourceId: id,
          action: 'update',
          diff: {
            before: {
              name: before.name,
              slug: before.slug,
              status: before.status,
              basePrice: before.basePrice.toFixed(2),
            },
            after: data,
          },
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        (tx) => tx.product.update({ where: { id }, data }),
      );

      res.json(toDto(product));
    } catch (e) {
      next(e);
    }
  },
);

// ── DELETE /api/admin/products/:id (soft-archive) ─────────────────────────────

adminProductsRouter.delete('/:id', ...writeGuard, async (req, res, next) => {
  try {
    const id = req.params['id'] as string;

    const before = await prisma.product.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!before) throw new AppError(ErrorCodes.PRODUCT_NOT_FOUND, 'Product not found', 404);
    if (before.status === 'ARCHIVED') {
      throw new AppError(ErrorCodes.PRODUCT_ALREADY_ARCHIVED, 'Product is already archived', 409);
    }

    await withAuditLog<Product>(
      {
        actorId: req.user!.id,
        resourceType: 'product',
        resourceId: id,
        action: 'archive',
        diff: { before: { status: before.status }, after: { status: 'ARCHIVED' } },
        ip: req.ip ?? undefined,
        userAgent: req.get('user-agent') ?? undefined,
      },
      (tx) => tx.product.update({ where: { id }, data: { status: 'ARCHIVED' } }),
    );

    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ── POST /api/admin/skus/:skuId/adjust-stock ─────────────────────────────────

adminSkusRouter.post(
  '/:skuId/adjust-stock',
  ...writeGuard,
  validateBody(AdjustStockBodySchema),
  async (req, res, next) => {
    try {
      const skuId = req.params['skuId'] as string;
      const { delta } = req.body as z.infer<typeof AdjustStockBodySchema>;

      // Verify existence before entering the tx for a clean 404 error code.
      const skuExists = await prisma.sku.findUnique({ where: { id: skuId }, select: { id: true } });
      if (!skuExists) throw new AppError(ErrorCodes.SKU_NOT_FOUND, 'SKU not found', 404);

      // Mutable payload — coreLogic populates before/after inside the tx.
      // withAuditLog reads ctx.diff AFTER coreLogic completes, so this is safe.
      const diffPayload: Record<string, unknown> = { delta };

      const updated = await withAuditLog<Sku>(
        {
          actorId: req.user!.id,
          resourceType: 'sku',
          resourceId: skuId,
          action: 'adjust_stock',
          diff: diffPayload as Prisma.InputJsonObject,
          ip: req.ip ?? undefined,
          userAgent: req.get('user-agent') ?? undefined,
        },
        async (tx) => {
          // Read current stock inside the tx (READ COMMITTED — latest committed state).
          const current = await tx.sku.findUniqueOrThrow({
            where: { id: skuId },
            select: { stock: true },
          });

          // Atomic conditional increment: WHERE stock + delta >= 0 prevents negative stock
          // under concurrent admin writes (the WHERE is evaluated at the DB level on the
          // locked row, unlike a pre-read → compare → write pattern which has TOCTOU).
          const result = await tx.sku.updateMany({
            where: { id: skuId, stock: { gte: delta < 0 ? -delta : 0 } },
            data: { stock: { increment: delta } },
          });

          if (result.count === 0) {
            throw new AppError(ErrorCodes.OUT_OF_STOCK, 'Adjusted stock cannot be negative', 409, {
              current: current.stock,
              delta,
            });
          }

          const freshSku = await tx.sku.findUniqueOrThrow({ where: { id: skuId } });

          // Populate diff after we have both before and after values.
          diffPayload['before'] = { stock: current.stock };
          diffPayload['after'] = { stock: freshSku.stock };

          return freshSku;
        },
      );

      res.json({ skuId: updated.id, stock: updated.stock });
    } catch (e) {
      next(e);
    }
  },
);
