import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { ErrorResponseSchema } from '@app/shared';

import { AppError } from '../src/lib/errors.js';
import { errorMiddleware } from '../src/middleware/error.js';

function buildAppWithRoutes(register: (app: Express) => void): Express {
  const app = express();
  register(app);
  app.use(errorMiddleware);
  return app;
}

describe('errorMiddleware', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('translates AppError into ErrorResponse JSON with declared status code', async () => {
    const app = buildAppWithRoutes((a) => {
      a.get('/boom', (_req, _res, next) => {
        next(new AppError('OUT_OF_STOCK', 'SKU 庫存不足', 409));
      });
    });

    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(() => ErrorResponseSchema.parse(res.body)).not.toThrow();
    expect(res.body).toEqual({
      error: { code: 'OUT_OF_STOCK', message: 'SKU 庫存不足' },
    });
  });

  it('includes details payload from AppError when provided', async () => {
    const app = buildAppWithRoutes((a) => {
      a.get('/boom', (_req, _res, next) => {
        next(
          new AppError('VALIDATION_ERROR', 'invalid input', 400, {
            field: 'email',
          }),
        );
      });
    });

    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ field: 'email' });
  });

  it('maps unexpected errors to 500 INTERNAL_ERROR without leaking stack in production', async () => {
    const app = buildAppWithRoutes((a) => {
      a.get('/explode', (_req, _res, next) => {
        next(new Error('secret stack trace details'));
      });
    });

    const res = await request(app).get('/explode');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).not.toContain('secret stack trace');
    expect(res.body.error.details).toBeUndefined();
    expect(() => ErrorResponseSchema.parse(res.body)).not.toThrow();
  });

  it('exposes stack in dev mode for unexpected errors (debugging aid only)', async () => {
    process.env.NODE_ENV = 'development';
    const app = buildAppWithRoutes((a) => {
      a.get('/explode', (_req, _res, next) => {
        next(new Error('readable in dev'));
      });
    });

    const res = await request(app).get('/explode');
    expect(res.status).toBe(500);
    expect(res.body.error.details).toBeDefined();
    expect(JSON.stringify(res.body.error.details)).toContain('readable in dev');
  });

  it('unknown route returns 404 with ErrorResponse shape', async () => {
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const res = await request(app).get('/api/this-does-not-exist');
    expect(res.status).toBe(404);
    expect(() => ErrorResponseSchema.parse(res.body)).not.toThrow();
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
