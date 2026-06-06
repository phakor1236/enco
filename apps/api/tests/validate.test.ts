import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { ErrorResponseSchema } from '@app/shared';

import { errorMiddleware } from '../src/middleware/error.js';
import { validateBody } from '../src/middleware/validate.js';

describe('validateBody middleware', () => {
  it('passes through when body matches schema', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const app = express();
    app.use(express.json());
    app.post('/echo', validateBody(schema), (req, res) => {
      res.json({ received: req.body });
    });
    app.use(errorMiddleware);

    const res = await request(app).post('/echo').send({ name: 'VELLA' });
    expect(res.status).toBe(200);
    expect(res.body.received).toEqual({ name: 'VELLA' });
  });

  it('returns 400 VALIDATION_ERROR (shaped as ErrorResponse) on invalid body', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const app = express();
    app.use(express.json());
    app.post('/echo', validateBody(schema), (req, res) => {
      res.json({ received: req.body });
    });
    app.use(errorMiddleware);

    const res = await request(app).post('/echo').send({ name: '' });
    expect(res.status).toBe(400);
    expect(() => ErrorResponseSchema.parse(res.body)).not.toThrow();
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
  });
});
