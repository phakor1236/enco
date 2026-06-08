import express from 'express';
// eslint-disable-next-line import/default
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/db.js';
import { optionalAuth, requireAuth, requireRole } from '../../src/middleware/auth.js';
import { errorMiddleware } from '../../src/middleware/error.js';
import { issueAccessToken } from '../../src/services/authService.js';

afterAll(async () => {
  await prisma.$disconnect();
});

/** Build a minimal app exposing protected routes for these tests. */
function buildApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });
  app.get('/admin-only', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), (req, res) => {
    res.json({ user: req.user });
  });
  app.get('/super-only', requireAuth, requireRole('SUPER_ADMIN'), (req, res) => {
    res.json({ user: req.user });
  });
  app.get('/maybe-me', optionalAuth, (req, res) => {
    res.json({ user: req.user ?? null });
  });

  app.use(errorMiddleware);
  return app;
}

const app = buildApp();

// ============================================================================
// requireAuth
// ============================================================================

describe('requireAuth', () => {
  it('returns 401 UNAUTHENTICATED when Authorization header is missing', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 UNAUTHENTICATED for a non-Bearer scheme', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 UNAUTHENTICATED for an empty bearer value', async () => {
    const res = await request(app).get('/me').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 INVALID_TOKEN for a tampered JWT', async () => {
    const token = issueAccessToken({ id: 'u-1', role: 'CUSTOMER' });
    const tampered = token.slice(0, -4) + 'XXXX';
    const res = await request(app).get('/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 TOKEN_EXPIRED for a JWT past its exp', async () => {
    const expired = jwt.sign({ sub: 'u-1', role: 'CUSTOMER' }, process.env.JWT_SECRET as string, {
      expiresIn: -1,
      algorithm: 'HS256',
    });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('attaches req.user with { id, role } on a valid token', async () => {
    const token = issueAccessToken({ id: 'u-42', role: 'CUSTOMER' });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'u-42', role: 'CUSTOMER' });
  });
});

// ============================================================================
// requireRole
// ============================================================================

describe('requireRole', () => {
  it('lets ADMIN through an ADMIN+SUPER_ADMIN gate', async () => {
    const token = issueAccessToken({ id: 'u-admin', role: 'ADMIN' });
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('lets SUPER_ADMIN through an ADMIN+SUPER_ADMIN gate', async () => {
    const token = issueAccessToken({ id: 'u-sa', role: 'SUPER_ADMIN' });
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects CUSTOMER on an admin-only route with 403 FORBIDDEN', async () => {
    const token = issueAccessToken({ id: 'u-cust', role: 'CUSTOMER' });
    const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects ADMIN on a SUPER_ADMIN-only route with 403', async () => {
    const token = issueAccessToken({ id: 'u-admin', role: 'ADMIN' });
    const res = await request(app).get('/super-only').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an unauthenticated request to an admin route with 401 (not 403)', async () => {
    const res = await request(app).get('/admin-only');
    expect(res.status).toBe(401);
  });

  it('throws at construction time when called with no roles (programmer error)', () => {
    expect(() => requireRole()).toThrow(/at least one role/);
  });
});

// ============================================================================
// optionalAuth
// ============================================================================

describe('optionalAuth', () => {
  it('continues as guest when no Authorization header is sent (req.user undefined)', async () => {
    const res = await request(app).get('/maybe-me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('continues as guest when header is non-Bearer (treated as no token)', async () => {
    const res = await request(app).get('/maybe-me').set('Authorization', 'Basic abc123');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('populates req.user on a valid Bearer token', async () => {
    const token = issueAccessToken({ id: 'u-7', role: 'CUSTOMER' });
    const res = await request(app).get('/maybe-me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'u-7', role: 'CUSTOMER' });
  });

  it('surfaces 401 TOKEN_EXPIRED for an expired token (no silent demotion to guest)', async () => {
    // Regression for the cart-strand bug: previously the catch swallowed
    // TokenExpiredError → cart router minted a guest cart_session → item
    // landed in a new guest cart instead of the member cart. Now 401 bubbles
    // so the FE apiClient interceptor can single-flight refresh and retry.
    const expired = jwt.sign({ sub: 'u-1', role: 'CUSTOMER' }, process.env.JWT_SECRET as string, {
      expiresIn: -1,
      algorithm: 'HS256',
    });
    const res = await request(app).get('/maybe-me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('surfaces 401 INVALID_TOKEN for a tampered token (no silent demotion to guest)', async () => {
    const token = issueAccessToken({ id: 'u-1', role: 'CUSTOMER' });
    const tampered = token.slice(0, -4) + 'XXXX';
    const res = await request(app).get('/maybe-me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
