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

  // ---- Phase 3 Cart --------------------------------------------------------
  CART_ITEM_NOT_FOUND: 'CART_ITEM_NOT_FOUND',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SKU_INACTIVE: 'SKU_INACTIVE',
  SKU_NOT_FOUND: 'SKU_NOT_FOUND',

  // ---- Phase 4 Checkout / Order -------------------------------------------
  CART_EMPTY: 'CART_EMPTY',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',

  // ---- Phase 5 Coupon ------------------------------------------------------
  COUPON_ALREADY_USED: 'COUPON_ALREADY_USED',
  COUPON_BELOW_MIN: 'COUPON_BELOW_MIN',
  COUPON_EXPIRED: 'COUPON_EXPIRED',
  COUPON_LIMIT_REACHED: 'COUPON_LIMIT_REACHED',
  COUPON_NOT_FOUND: 'COUPON_NOT_FOUND',
  COUPON_NOT_STARTED: 'COUPON_NOT_STARTED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
