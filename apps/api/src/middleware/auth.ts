import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../services/authService.js';

/**
 * Augments Express's Request with a typed `user` payload (sub + role).
 * Populated by requireAuth; downstream handlers can rely on it being present.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
    }
  }
}

/**
 * Verifies a Bearer access token on the Authorization header and attaches
 * `req.user = { id, role }` for downstream handlers. Throws via next():
 *  - missing/malformed header  → 401 UNAUTHENTICATED
 *  - invalid signature / shape → 401 INVALID_TOKEN  (from authService)
 *  - expired                   → 401 TOKEN_EXPIRED  (from authService)
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(
        ErrorCodes.UNAUTHENTICATED,
        'Missing or malformed Authorization header',
        401,
      );
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new AppError(ErrorCodes.UNAUTHENTICATED, 'Empty bearer token', 401);
    }

    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Optional auth: if a valid Bearer token is present, populate req.user;
 * if no Authorization header was sent, continue as guest. Used by routes
 * (e.g. /cart) that serve both logged-in and guest callers.
 *
 * Distinct from "no token at all": a present-but-bad token MUST surface
 * 401 (TOKEN_EXPIRED / INVALID_TOKEN) so the FE apiClient interceptor can
 * single-flight refresh and retry. Silently demoting an expired member to
 * a guest cart would strand items in a fresh guest cart instead.
 */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header) return next();
  if (!header.startsWith('Bearer ')) return next();
  const token = header.slice('Bearer '.length).trim();
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Gate a route to one of the allowed roles. Must be chained AFTER requireAuth.
 *   router.post('/products', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), handler)
 *
 * Defensive: if req.user is missing (forgot to chain requireAuth), responds
 * UNAUTHENTICATED rather than silently allowing through.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  if (allowed.length === 0) {
    throw new Error('requireRole(): at least one role must be allowed');
  }
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(ErrorCodes.UNAUTHENTICATED, 'Auth required', 401));
    }
    if (!allowed.includes(req.user.role)) {
      return next(
        new AppError(
          ErrorCodes.FORBIDDEN,
          `Role '${req.user.role}' is not permitted on this route`,
          403,
        ),
      );
    }
    next();
  };
}
