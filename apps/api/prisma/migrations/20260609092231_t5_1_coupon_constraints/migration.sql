-- T5.1 follow-up: tighten Coupon invariants that Prisma can't express
-- declaratively. These constraints stay permanently — Prisma introspection
-- ignores and will never regenerate or drop them.

-- 1. value > 0: a zero-value coupon is meaningless.
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_value_positive" CHECK ("value" > 0);

-- 2. usage_limit > 0 when set: NULL means unlimited; 0 means "blocked"
--    which we disallow (just delete the coupon instead).
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_usage_limit_positive" CHECK ("usage_limit" IS NULL OR "usage_limit" > 0);