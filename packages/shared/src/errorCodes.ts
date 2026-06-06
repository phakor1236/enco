/**
 * Canonical API error codes — single source of truth shared between BE
 * (throws `new AppError(ErrorCodes.X, ...)`) and FE (matches the response's
 * `error.code` against the same constant). Typos become compile errors
 * instead of silent "fallback" UI paths.
 *
 * Per phase additions appear in their own block. Keep alphabetized within
 * each phase so collisions surface immediately at code review.
 */
export const ErrorCodes = {
  // ---- Cross-cutting -------------------------------------------------------
  CONFIG_ERROR: 'CONFIG_ERROR',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // ---- Phase 1 Auth --------------------------------------------------------
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_RACED: 'TOKEN_RACED',
  TOKEN_REUSED: 'TOKEN_REUSED',

  // ---- Phase 2 Catalog -----------------------------------------------------
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
