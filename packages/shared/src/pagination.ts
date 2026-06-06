import { z } from 'zod';

export const PageRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type PageRequest = z.infer<typeof PageRequestSchema>;

export const PageResponseSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
});
export type PageResponse<T> = { items: T[]; nextCursor: string | null };
