import { Router, type Router as RouterType } from 'express';
import { CouponValidateBodySchema } from '@app/shared';

import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { validateCoupon } from '../services/couponService.js';

export const couponsRouter: RouterType = Router();

/**
 * POST /api/coupons/validate
 * Body: { code, subtotal }
 * Returns the computed discountAmount for display on the checkout page.
 * Auth required: we must know the userId to check per-user usage.
 */
couponsRouter.post(
  '/validate',
  requireAuth,
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
