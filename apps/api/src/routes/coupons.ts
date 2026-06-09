import { Router, type Router as RouterType, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { CouponValidateBodySchema, ErrorCodes } from '@app/shared';

import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { validateCoupon } from '../services/couponService.js';

export const couponsRouter: RouterType = Router();

// Keyed by userId (not IP) so VPN/proxy rotation can't bypass the cap.
// 20 req/min is generous for manual checkout use but blocks automated probing.
const validateLimit: RequestHandler = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: { code: ErrorCodes.RATE_LIMITED, message: 'Too many requests' } });
  },
});

/**
 * POST /api/coupons/validate
 * Body: { code, subtotal }
 * Returns the computed discountAmount for display on the checkout page.
 * Auth required: userId is needed to check per-user usage.
 */
couponsRouter.post(
  '/validate',
  requireAuth,
  validateLimit,
  validateBody(CouponValidateBodySchema),
  async (req, res, next) => {
    try {
      const { code, subtotal } = req.body as { code: string; subtotal: string };
      const result = await validateCoupon(code, req.user!.id, subtotal);
      res.json({
        code: result.coupon.code,
        type: result.coupon.type,
        value: result.coupon.value.toFixed(2),
        discountAmount: result.discountAmount.toFixed(2),
      });
    } catch (err) {
      next(err);
    }
  },
);
