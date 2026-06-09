import { Prisma } from '@prisma/client';
import { ErrorCodes } from '@app/shared';

import { type DbClient, prisma } from '../lib/db.js';
import { AppError } from '../lib/errors.js';

export interface CouponValidationResult {
  coupon: {
    id: string;
    code: string;
    type: 'FIXED' | 'PERCENT';
    value: Prisma.Decimal;
  };
  discountAmount: Prisma.Decimal;
}

/**
 * Validates a coupon code for a given user and subtotal, returning the
 * discount amount to apply. Checks (in order):
 *   1. Existence
 *   2. startsAt (not yet active)
 *   3. endsAt (expired)
 *   4. minAmount (order too small)
 *   5. usageLimit (global cap reached)
 *   6. per-user ALREADY_USED
 *
 * Accepts `db` so T5.3's checkout tx can call this directly — any thrown
 * AppError rolls back the outer transaction automatically.
 */
export async function validateCoupon(
  code: string,
  userId: string,
  subtotal: Prisma.Decimal | string,
  db: DbClient = prisma,
): Promise<CouponValidationResult> {
  const sub = new Prisma.Decimal(subtotal.toString());
  const now = new Date();

  const coupon = await db.coupon.findUnique({
    where: { code },
    include: { _count: { select: { usages: true } } },
  });

  if (!coupon) {
    throw new AppError(ErrorCodes.COUPON_NOT_FOUND, `找不到優惠碼：${code}`, 404);
  }
  if (coupon.startsAt && now < coupon.startsAt) {
    throw new AppError(ErrorCodes.COUPON_NOT_STARTED, '優惠碼尚未開始使用', 422, {
      startsAt: coupon.startsAt.toISOString(),
    });
  }
  if (coupon.endsAt && now > coupon.endsAt) {
    throw new AppError(ErrorCodes.COUPON_EXPIRED, '優惠碼已過期', 422, {
      endsAt: coupon.endsAt.toISOString(),
    });
  }
  if (coupon.minAmount && sub.lessThan(coupon.minAmount)) {
    throw new AppError(
      ErrorCodes.COUPON_BELOW_MIN,
      `訂單金額不足，最低需 ${coupon.minAmount}`,
      422,
      { minAmount: coupon.minAmount.toString() },
    );
  }
  if (coupon.usageLimit !== null && coupon._count.usages >= coupon.usageLimit) {
    throw new AppError(ErrorCodes.COUPON_LIMIT_REACHED, '優惠碼已達使用上限', 422);
  }

  const existingUsage = await db.couponUsage.findUnique({
    where: { couponId_userId: { couponId: coupon.id, userId } },
  });
  if (existingUsage) {
    throw new AppError(ErrorCodes.COUPON_ALREADY_USED, '您已使用過此優惠碼', 422);
  }

  let discountAmount: Prisma.Decimal;
  if (coupon.type === 'FIXED') {
    // Cap at subtotal so discount can't produce a negative total.
    discountAmount = coupon.value.greaterThan(sub) ? sub : coupon.value;
  } else {
    // PERCENT: value is 0–100 (e.g. 10 → 10% off). Round half-up to 2 dp.
    discountAmount = sub.times(coupon.value).dividedBy(100).toDecimalPlaces(2);
  }

  return {
    coupon: { id: coupon.id, code: coupon.code, type: coupon.type, value: coupon.value },
    discountAmount,
  };
}
