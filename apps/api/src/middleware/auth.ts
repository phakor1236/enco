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
 * if absent or malformed, continue with req.user undefined. Used by routes
 * (e.g. /cart) that serve both logged-in and guest callers — the handler
 * branches on req.user itself.
 *
 * Distinct from requireAuth: never throws on absent/bad token, only on a
 * malformed `Bearer` prefix that suggests a buggy client.
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
  } catch {
    // Expired or invalid token: treat as guest. FE single-flight refresh
    // (apiClient interceptor) will retry with a fresh token if available.
  }
  next();
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
