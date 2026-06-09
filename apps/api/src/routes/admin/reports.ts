import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';

import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validateQuery } from '../../middleware/validate.js';
import {
  getDailyReport,
  getByProductReport,
  getMonthlyReport,
} from '../../services/reportService.js';

export const adminReportsRouter: RouterType = Router();

const adminGuard = [requireAuth, requireRole('ADMIN', 'SUPER_ADMIN')];

// ── Query schemas ─────────────────────────────────────────────────────────────

const DailyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const MonthlyQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});

const ByProductQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});

// ── GET /api/admin/reports/daily ──────────────────────────────────────────────

adminReportsRouter.get(
  '/daily',
  ...adminGuard,
  validateQuery(DailyQuerySchema),
  async (req, res, next) => {
    try {
      const { days } = (req as unknown as { validatedQuery: z.infer<typeof DailyQuerySchema> })
        .validatedQuery;
      const rows = await getDailyReport(days);
      res.json({ rows, days });
    } catch (e) {
      next(e);
    }
  },
);

// ── GET /api/admin/reports/monthly ────────────────────────────────────────────

adminReportsRouter.get(
  '/monthly',
  ...adminGuard,
  validateQuery(MonthlyQuerySchema),
  async (req, res, next) => {
    try {
      const { months } = (req as unknown as { validatedQuery: z.infer<typeof MonthlyQuerySchema> })
        .validatedQuery;
      const rows = await getMonthlyReport(months);
      res.json({ rows, months });
    } catch (e) {
      next(e);
    }
  },
);

// ── GET /api/admin/reports/by-product ────────────────────────────────────────

adminReportsRouter.get(
  '/by-product',
  ...adminGuard,
  validateQuery(ByProductQuerySchema),
  async (req, res, next) => {
    try {
      const { limit, startDate, endDate } = (
        req as unknown as { validatedQuery: z.infer<typeof ByProductQuerySchema> }
      ).validatedQuery;
      const rows = await getByProductReport({
        limit,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate + 'T23:59:59.999Z') : undefined,
      });
      res.json({ rows });
    } catch (e) {
      next(e);
    }
  },
);
