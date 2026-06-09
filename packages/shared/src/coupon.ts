import { z } from 'zod';

export const CouponValidateBodySchema = z.object({
  code: z.string().min(1, '請輸入優惠碼'),
  subtotal: z.string().regex(/^\d+(\.\d{1,2})?$/, '金額格式不正確（例：100 或 100.00）'),
});

export const CouponValidateResultSchema = z.object({
  code: z.string(),
  type: z.enum(['FIXED', 'PERCENT']),
  value: z.string(),
  discountAmount: z.string(),
});

export type CouponValidateBody = z.infer<typeof CouponValidateBodySchema>;
export type CouponValidateResult = z.infer<typeof CouponValidateResultSchema>;
