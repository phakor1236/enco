import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { errorMiddleware } from './middleware/error.js';
import { healthRouter } from './routes/health.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  app.use('/api', healthRouter);

  // 404 — keep shape consistent with ErrorResponse via AppError + errorMiddleware
  app.use((_req, _res, next) => {
    next(new AppError('NOT_FOUND', 'Resource not found', 404));
  });

  app.use(errorMiddleware);
  return app;
}
