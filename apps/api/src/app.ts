import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
// eslint-disable-next-line import/default
import swaggerUi from 'swagger-ui-express';
import { ErrorCodes } from '@app/shared';

import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { buildOpenApiDocument } from './lib/openapi.js';
import { errorMiddleware } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { cartRouter } from './routes/cart.js';
import { checkoutRouter } from './routes/checkout.js';
import { couponsRouter } from './routes/coupons.js';
import { healthRouter } from './routes/health.js';
import { ordersRouter } from './routes/orders.js';
import { categoriesRouter, productsRouter } from './routes/products.js';
import { webhooksRouter } from './routes/webhooks.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Trust X-Forwarded-For so req.ip is accurate behind a reverse proxy
  // (Vercel / Fly). Tests also use this to simulate distinct client IPs
  // when exercising per-IP rate limits.
  //
  // SECURITY: this assumes a trusted upstream proxy (Vercel rewrites in front
  // of the Fly API per SPEC §8). If the API is ever exposed *directly* on the
  // public internet, per-IP rate limits become spoofable via forged
  // X-Forwarded-For — drop the setting or pin to the proxy's IP.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      // Redact bearer + cookie values from access logs to stop refresh tokens
      // / access JWTs leaking into log aggregators.
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
    }),
  );

  app.use('/api/auth', authRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/checkout', checkoutRouter);
  app.use('/api/coupons', couponsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api', healthRouter);

  // OpenAPI docs — open in dev/test, gated by env flag in prod (SPEC §8).
  if (process.env.NODE_ENV !== 'production' || process.env.EXPOSE_API_DOCS === 'true') {
    const openApiDoc = buildOpenApiDocument();
    app.get('/api/docs.json', (_req, res) => {
      res.json(openApiDoc);
    });
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  }

  // 404 — keep shape consistent with ErrorResponse via AppError + errorMiddleware
  app.use((_req, _res, next) => {
    next(new AppError(ErrorCodes.NOT_FOUND, 'Resource not found', 404));
  });

  app.use(errorMiddleware);
  return app;
}
