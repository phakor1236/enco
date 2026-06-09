import { z } from 'zod';

export const ShippingAddressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  city: z.string().min(1),
  addr: z.string().min(1),
});

export const CheckoutBody = z.object({
  shippingAddress: ShippingAddressSchema,
  paymentMethod: z.string().min(1),
  outcomeMode: z.enum(['AUTO_SUCCESS', 'AUTO_FAILURE', 'MANUAL']).optional(),
});

export const CheckoutResultDtoSchema = z.object({
  orderId: z.string(),
  paymentIntentId: z.string(),
});

export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type CheckoutBodyType = z.infer<typeof CheckoutBody>;
export type CheckoutResultDto = z.infer<typeof CheckoutResultDtoSchema>;
