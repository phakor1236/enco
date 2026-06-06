import type { ErrorRequestHandler } from 'express';
import type { ErrorResponse } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  // Stack-leak guard: only 'development' opens the door. 'test' and any
  // unknown NODE_ENV value default to the production-safe payload.
  const isDev = process.env.NODE_ENV === 'development';

  if (err instanceof AppError) {
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    res.status(err.status).json(body);
    return;
  }

  // Unknown error: log full detail server-side, return safe payload.
  logger.error({ err }, 'unhandled error');

  const body: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      ...(isDev && err instanceof Error
        ? { details: { name: err.name, message: err.message, stack: err.stack } }
        : {}),
    },
  };
  res.status(500).json(body);
};
