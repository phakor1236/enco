import { z } from 'zod';

const ErrorCode = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'error code must be UPPER_SNAKE_CASE');

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
