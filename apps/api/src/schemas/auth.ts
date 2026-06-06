import { z } from 'zod';

/**
 * Request bodies for /api/auth/*. Shared with FE via @app/shared in a later
 * slice — for now they live api-side only. Defensive bounds:
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
