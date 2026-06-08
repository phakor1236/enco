import { z } from 'zod';

import { CartMergeResultSchema } from './cart.js';

/**
 * Auth request bodies — shared between API (validates incoming JSON) and FE
 * (validates form input before POST). Defensive bounds:
 *  - email max 254 chars (RFC 5321)
 *  - password min 8 / max 72 (bcrypt truncates >72-byte inputs)
 */
export const RegisterBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(72),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(72),
});
export type LoginBody = z.infer<typeof LoginBody>;

/** Server response shapes — `accessToken` is short-lived (15min) and kept in memory. */
export const Role = z.enum(['CUSTOMER', 'ADMIN', 'SUPER_ADMIN']);
export type Role = z.infer<typeof Role>;

export const UserDto = z.object({
  id: z.string(),
  email: z.string().email(),
  role: Role,
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthSuccess = z.object({
  user: UserDto,
  accessToken: z.string(),
  // T3.3: always present on /register and /login responses; empty arrays when
  // no guest cart cookie was sent or there was nothing to merge.
  cartMergeResult: CartMergeResultSchema,
});
export type AuthSuccess = z.infer<typeof AuthSuccess>;
