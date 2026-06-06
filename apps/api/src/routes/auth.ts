import { Router, type Response, type Router as RouterType, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import { LoginBody, RegisterBody } from '@app/shared';

import { prisma } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { validateBody } from '../middleware/validate.js';
import {
  AuthErrorCodes,
  hashPassword,
  issueAccessToken,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyPassword,
} from '../services/authService.js';

const REFRESH_COOKIE = 'vella_refresh';
// Constant-time-ish dummy hash so login bcrypt-compare runs even when the email
// doesn't exist — denies a timing oracle to distinguish "no user" vs "wrong pw".
const DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuO0gMFr2YfHV0nLqLVu7Q4Bd2bXt1aRSi';

function refreshCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000,
  };
}

function setRefreshCookie(res: Response, plain: string): void {
  res.cookie(REFRESH_COOKIE, plain, refreshCookieOptions());
}

// ---------------------------------------------------------------------------
// Rate limiters (SPEC §9 — login 5/min/IP, register 3/day/IP)
// ---------------------------------------------------------------------------

function makeLimiter(windowMs: number, max: number, code: string): RequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code, message: 'Too many requests' } });
    },
  });
}

const loginLimit = makeLimiter(
  60_000,
  Number(process.env.RATE_LIMIT_LOGIN_PER_MIN ?? 5),
  'RATE_LIMITED',
);

const registerLimit = makeLimiter(
  24 * 60 * 60 * 1000,
  Number(process.env.RATE_LIMIT_REGISTER_PER_DAY_PER_IP ?? 3),
  'RATE_LIMITED',
);

// Refresh + logout get a generous per-IP limit. Token entropy makes brute force
// pointless; this just caps DDoS amplification from a single source.
const sessionLimit = makeLimiter(
  60_000,
  Number(process.env.RATE_LIMIT_SESSION_PER_MIN ?? 60),
  'RATE_LIMITED',
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const authRouter: RouterType = Router();

authRouter.post('/register', registerLimit, validateBody(RegisterBody), async (req, res, next) => {
  try {
    const { email, password } = req.body as RegisterBody;

    const passwordHash = await hashPassword(password);
    const userAgent = req.get('user-agent') ?? null;
    const ip = req.ip ?? null;

    let user;
    let refresh;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email, passwordHash, role: 'CUSTOMER' },
        });
        // TODO(P3): mergeGuestCart(created.id, req.cookies?.cart_session, tx)
        const r = await issueRefreshToken(tx, created.id, { userAgent, ip });
        return { user: created, refresh: r };
      });
      user = result.user;
      refresh = result.refresh;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError('EMAIL_TAKEN', 'Email already registered', 409);
      }
      throw e;
    }

    const accessToken = issueAccessToken(user);
    setRefreshCookie(res, refresh.plain);
    res.status(201).json({
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', loginLimit, validateBody(LoginBody), async (req, res, next) => {
  try {
    const { email, password } = req.body as LoginBody;
    const user = await prisma.user.findUnique({ where: { email } });
    const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, hashToCheck);

    if (!user || !ok) {
      throw new AppError('INVALID_CREDENTIALS', 'Email or password incorrect', 401);
    }

    // TODO(P3): wrap below in prisma.$transaction and call
    //   mergeGuestCart(user.id, req.cookies?.cart_session, tx)
    //   inside the same tx, before issueRefreshToken. Merge failures must
    //   only log + flag the response (see plan T3.3), never block login.
    const refresh = await issueRefreshToken(prisma, user.id, {
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
    });
    const accessToken = issueAccessToken(user);

    setRefreshCookie(res, refresh.plain);
    res.json({
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/refresh', sessionLimit, async (req, res, next) => {
  try {
    const plain: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof plain !== 'string' || plain.length === 0) {
      throw new AppError(AuthErrorCodes.INVALID_TOKEN, 'Refresh cookie missing', 401);
    }

    const result = await prisma.$transaction(async (tx) => {
      return rotateRefreshToken(tx, plain, {
        userAgent: req.get('user-agent') ?? null,
        ip: req.ip ?? null,
      });
    });

    res.cookie(REFRESH_COOKIE, result.refresh.plain, refreshCookieOptions());
    res.json({
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', sessionLimit, async (req, res, next) => {
  try {
    const plain: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof plain === 'string' && plain.length > 0) {
      await revokeRefreshToken(prisma, plain);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});
