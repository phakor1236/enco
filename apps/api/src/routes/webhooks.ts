import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';

import { validateBody } from '../middleware/validate.js';
import { processPaymentOutcome } from '../services/paymentService.js';

export const webhooksRouter: RouterType = Router();

const WebhookMockBody = z.object({
  paymentIntentId: z.string().uuid(),
});

/**
 * POST /webhooks/payment/mock
 *
 * Simulates a PSP payment-outcome callback. Idempotent: replaying the same
 * paymentIntentId after the order has already been transitioned is a no-op
 * (returns 200). The actual outcome (PAID / CANCELLED) is determined by the
 * outcomeMode stored on the PaymentMock row at checkout time.
 *
 * In production this endpoint would validate a webhook signature. For the
 * mock provider the URL itself is the "secret" — it is never exposed in the
 * FE bundle, only called by the internal setTimeout in the checkout route.
 */
webhooksRouter.post('/payment/mock', validateBody(WebhookMockBody), async (req, res, next) => {
  try {
    await processPaymentOutcome((req.body as { paymentIntentId: string }).paymentIntentId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
