import { z } from 'zod';

/**
 * Cart contracts shared between BE (validates incoming bodies) and FE
 * (validates form input + types the response). Money strings reuse the
 * catalog MoneyString shape via the existing catalog module.
 */

// Per-item caps. 99 is the standard storefront upper bound; higher = "talk to
// sales" territory, which we don't have. Enforced both client-side (this Zod
// schema) and server-side (same schema), so a tampered request still 400s.
const MAX_QTY_PER_LINE = 99;

export const AddCartItemBody = z.object({
  skuId: z.string().min(1).max(64),
  qty: z.coerce.number().int().min(1).max(MAX_QTY_PER_LINE),
});
export type AddCartItemBody = z.infer<typeof AddCartItemBody>;

export const UpdateCartItemBody = z.object({
  qty: z.coerce.number().int().min(1).max(MAX_QTY_PER_LINE),
});
export type UpdateCartItemBody = z.infer<typeof UpdateCartItemBody>;

export const CartItemDtoSchema = z.object({
  id: z.string(),
  skuId: z.string(),
  qty: z.number().int().positive(),
  // Frozen pricing for display ergonomics — service reads SKU at response
  // time so price reflects whatever the user would actually pay if they
  // checked out right now (no FE caching surprises).
  unitPrice: z.string(),
  lineTotal: z.string(),
  // Snapshot fields denormalized at response time so the cart drawer doesn't
  // need a follow-up products query just to render names + images.
  product: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    primaryImage: z.object({ url: z.string().url(), alt: z.string().nullable() }).nullable(),
  }),
  skuCode: z.string(),
  optionCombination: z.record(z.string()),
  stock: z.number().int().nonnegative(),
});
export type CartItemDto = z.infer<typeof CartItemDtoSchema>;

export const CartDtoSchema = z.object({
  id: z.string(),
  items: z.array(CartItemDtoSchema),
  itemCount: z.number().int().nonnegative(),
  subtotal: z.string(),
});
export type CartDto = z.infer<typeof CartDtoSchema>;

/**
 * Result of merging a guest cart into a member cart on login/register.
 * Drives the FE post-login toast — "N item(s) capped at stock", "M item(s)
 * no longer available". Always present in auth responses; empty arrays
 * when nothing merged (no guest cart, no cookie, or merge errored silently).
 */
export const CartMergeResultSchema = z.object({
  truncatedItems: z.array(
    z.object({
      skuId: z.string(),
      requested: z.number().int().positive(),
      granted: z.number().int().nonnegative(),
    }),
  ),
  droppedItems: z.array(
    z.object({
      skuId: z.string(),
      reason: z.enum(['INACTIVE', 'OUT_OF_STOCK']),
    }),
  ),
});
export type CartMergeResult = z.infer<typeof CartMergeResultSchema>;

export const CART_LIMITS = { MAX_QTY_PER_LINE } as const;
