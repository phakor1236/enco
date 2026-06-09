import { Router, type Router as RouterType } from 'express';
import { CheckoutBody, type CheckoutBodyType } from '@app/shared';

import { logger } from '../lib/logger.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { checkout } from '../services/checkoutService.js';
import { processPaymentOutcome } from '../services/paymentService.js';

export const checkoutRouter: RouterType = Router();

checkoutRouter.post('/', requireAuth, validateBody(CheckoutBody), async (req, res, next) => {
  try {
    const result = await checkout(req.user!.id, req.body);

    // Simulate PSP callback after response is delivered. The setTimeout
    // guarantees the 201 reaches the client before the order state changes —
    // so the FE receives PENDING and can show an "awaiting payment" screen
    // before the PAID / CANCELLED transition lands. MANUAL mode skips this;
    // a human-triggered webhook is expected instead.
    //
    // .unref() prevents this timer from holding the event loop open when
    // tests tear down — the callback is fire-and-forget.
    const { outcomeMode = 'AUTO_SUCCESS' } = req.body as CheckoutBodyType;
    if (outcomeMode !== 'MANUAL') {
      const delay = Math.floor(Math.random() * 300) + 200;
      setTimeout(() => {
        processPaymentOutcome(result.paymentIntentId).catch((err) =>
          logger.error({ err, orderId: result.orderId }, 'payment simulation failed'),
        );
      }, delay).unref();
    }

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});
