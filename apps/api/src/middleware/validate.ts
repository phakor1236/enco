import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';

export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(ErrorCodes.VALIDATION_ERROR, 'Request body failed validation', 400, {
          issues: result.error.issues,
        }),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        new AppError(ErrorCodes.VALIDATION_ERROR, 'Query parameters failed validation', 400, {
          issues: result.error.issues,
        }),
      );
      return;
    }
    // Express 5 query is read-only; attach validated value separately.
    (req as unknown as { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}
