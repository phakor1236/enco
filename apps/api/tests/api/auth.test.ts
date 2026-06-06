import { randomBytes } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';

const app = createApp();

// Every test makes its own user under a marker domain so afterAll cleanup
// can wipe them all in one query.
const EMAIL_DOMAIN = 'e2e-auth.test';
function newEmail(label = ''): string {
  return `${label}-${randomBytes(4).toString('hex')}@${EMAIL_DOMAIN}`;
}

function newIp(): string {
  // Synthetic source IP per test so per-IP rate limits don't leak between tests
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  // Tests that touch /register make permanent rows; clean them between cases
  // so the seed.test.ts and concurrency tests are not surprised. Cheap.
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
});

/** Parse Set-Cookie header(s) into an array of cookie attribute maps. */
function parseSetCookie(header: string | string[] | undefined): Array<Record<string, string>> {
  if (!header) return [];
  const arr = Array.isArray(header) ? header : [header];
  return arr.map((cookie) => {
    const parts = cookie.split(';').map((p) => p.trim());
    const result: Record<string, string> = {};
    const [first, ...attrs] = parts;
    const [name, ...vrest] = (first ?? '').split('=');
    if (name) result.name = name;
    result.value = vrest.join('=');
    for (const a of attrs) {
      const [k, ...vp] = a.split('=');
      if (k) result[k.toLowerCase()] = vp.join('=') || 'true';
    }
    return result;
  });
}

// ============================================================================
// POST /api/auth/register
// ============================================================================

describe('POST /api/auth/register', () => {
  it('creates a user, returns access token + sets HttpOnly refresh cookie (201)', async () => {
    const email = newEmail('reg');
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email, password: 'hunter22hunter22' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(typeof res.body.accessToken).toBe('string');

    const cookies = parseSetCookie(res.headers['set-cookie']);
    const refreshCookie = cookies.find((c) => c.name === 'vella_refresh');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.httponly).toBe('true');
    expect(refreshCookie?.path).toBe('/api/auth');
    expect(refreshCookie?.samesite?.toLowerCase()).toBe('lax');
    expect(refreshCookie?.value?.length ?? 0).toBeGreaterThan(20);

    // Persisted
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.passwordHash).not.toBe('hunter22hunter22'); // hashed
  });

  it('rejects duplicate email with 409 EMAIL_TAKEN', async () => {
    const email = newEmail('dup');
    await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email, password: 'password123' });

    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email, password: 'other-password' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects short password with 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email: newEmail('bad'), password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed email with 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ============================================================================
// POST /api/auth/login
// ============================================================================

describe('POST /api/auth/login', () => {
  it('logs in an existing user with correct password (200 + cookie)', async () => {
    const email = newEmail('login');
    const password = 'login-password-1';
    await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email, password });

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', newIp())
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(typeof res.body.accessToken).toBe('string');
    expect(parseSetCookie(res.headers['set-cookie']).some((c) => c.name === 'vella_refresh')).toBe(
      true,
    );
  });

  it('returns 401 INVALID_CREDENTIALS for wrong password', async () => {
    const email = newEmail('wrongpw');
    await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email, password: 'correct-password' });

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', newIp())
      .send({ email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 INVALID_CREDENTIALS for non-existent email (no user enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', newIp())
      .send({ email: newEmail('noone'), password: 'whatever123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

// ============================================================================
// POST /api/auth/refresh
// ============================================================================

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh cookie + returns a fresh access token', async () => {
    const agent = request.agent(app);
    const email = newEmail('refresh');
    const ip = newIp();

    const reg = await agent
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'password123' });
    expect(reg.status).toBe(201);
    const firstAccess = reg.body.accessToken;
    const firstRefreshCookie = parseSetCookie(reg.headers['set-cookie']).find(
      (c) => c.name === 'vella_refresh',
    )?.value;
    expect(firstRefreshCookie).toBeTruthy();

    // Wait a beat so the new JWT has a different `iat` (seconds-resolution exp)
    await new Promise((r) => setTimeout(r, 1100));

    const res = await agent.post('/api/auth/refresh').set('X-Forwarded-For', ip).send();
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.accessToken).not.toBe(firstAccess);
    const newRefreshCookie = parseSetCookie(res.headers['set-cookie']).find(
      (c) => c.name === 'vella_refresh',
    )?.value;
    expect(newRefreshCookie).toBeTruthy();
    expect(newRefreshCookie).not.toBe(firstRefreshCookie);
  });

  it('returns 401 when the refresh cookie is missing', async () => {
    const res = await request(app).post('/api/auth/refresh').set('X-Forwarded-For', newIp()).send();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for an unknown refresh value', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('X-Forwarded-For', newIp())
      .set('Cookie', 'vella_refresh=this-is-not-a-real-token')
      .send();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 TOKEN_REUSED when an old refresh token is replayed after rotating past it', async () => {
    const agent = request.agent(app);
    const email = newEmail('reuse');
    const ip = newIp();

    // 1. Register — capture refresh1 BEFORE any rotation so we can replay it later
    const reg = await agent
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'password123' });
    const refresh1 = parseSetCookie(reg.headers['set-cookie']).find(
      (c) => c.name === 'vella_refresh',
    )?.value;
    expect(refresh1).toBeTruthy();

    // 2. Rotate twice — refresh1 → refresh2 → refresh3.
    //    After this, refresh1 is the grandparent of the active token (NOT the
    //    immediate parent), so grace-window does not apply when we replay it.
    await agent.post('/api/auth/refresh').set('X-Forwarded-For', ip).send();
    await agent.post('/api/auth/refresh').set('X-Forwarded-For', ip).send();

    // 3. Replay refresh1 via raw Cookie header (bypassing agent's cookie jar)
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('X-Forwarded-For', ip)
      .set('Cookie', `vella_refresh=${refresh1}`)
      .send();
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REUSED');
  });
});

// ============================================================================
// POST /api/auth/logout
// ============================================================================

describe('POST /api/auth/logout', () => {
  it('clears the refresh cookie + revokes the DB-side token (204)', async () => {
    const agent = request.agent(app);
    const email = newEmail('logout');
    const ip = newIp();

    const reg = await agent
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'password123' });
    const refreshValue = parseSetCookie(reg.headers['set-cookie']).find(
      (c) => c.name === 'vella_refresh',
    )?.value;
    expect(refreshValue).toBeTruthy();

    const res = await agent.post('/api/auth/logout').set('X-Forwarded-For', ip).send();
    expect(res.status).toBe(204);

    // Cookie expiry signal — Max-Age=0 or in the past
    const cleared = parseSetCookie(res.headers['set-cookie']).find(
      (c) => c.name === 'vella_refresh',
    );
    expect(cleared).toBeDefined();

    // DB-side: replaying the same refresh now fails with TOKEN_REUSED / INVALID
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('X-Forwarded-For', ip)
      .set('Cookie', `vella_refresh=${refreshValue}`)
      .send();
    expect(replay.status).toBe(401);
  });

  it('is idempotent — logout without a refresh cookie still returns 204', async () => {
    const res = await request(app).post('/api/auth/logout').set('X-Forwarded-For', newIp()).send();
    expect(res.status).toBe(204);
  });
});

// ============================================================================
// Rate limits
// ============================================================================

describe('Rate limits (SPEC §9)', () => {
  it('blocks the 6th login attempt within a minute from the same IP', async () => {
    const ip = newIp();
    const email = newEmail('ratelogin');
    await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', newIp())
      .send({ email, password: 'password123' });

    // 5 attempts (allowed): use wrong password so they fail-validly with 401
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'wrong' });
      expect(r.status).toBe(401);
    }

    // 6th must trip the limiter
    const sixth = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'wrong' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');
  });

  it('blocks the 4th register attempt within a day from the same IP', async () => {
    const ip = newIp();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app)
        .post('/api/auth/register')
        .set('X-Forwarded-For', ip)
        .send({ email: newEmail(`rlreg${i}`), password: 'password123' });
      expect(r.status).toBe(201);
    }

    const fourth = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', ip)
      .send({ email: newEmail('rl-blocked'), password: 'password123' });
    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('RATE_LIMITED');
  });
});
