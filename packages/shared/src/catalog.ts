import { z } from 'zod';

// Money is serialized as a decimal string ("29.00") so JSON consumers never
// hit float-precision drift. FE uses Intl.NumberFormat to render.
const MoneyString = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'must be a decimal string with at most 2 fraction digits');

export const ProductStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const SkuStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type SkuStatus = z.infer<typeof SkuStatusSchema>;

export const CategoryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  parentId: z.string().nullable(),
});
export type CategoryDto = z.infer<typeof CategoryDtoSchema>;

export const ProductImageDtoSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  alt: z.string().nullable(),
  sort: z.number().int(),
});
export type ProductImageDto = z.infer<typeof ProductImageDtoSchema>;

const ProductCategoryRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const VariantOptionDtoSchema = z.object({
  id: z.string(),
  value: z.string(),
  sort: z.number().int(),
});
export type VariantOptionDto = z.infer<typeof VariantOptionDtoSchema>;

export const VariantDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  options: z.array(VariantOptionDtoSchema),
});
export type VariantDto = z.infer<typeof VariantDtoSchema>;

export const SkuDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  price: MoneyString,
  stock: z.number().int().nonnegative(),
  optionCombination: z.record(z.string()),
  status: SkuStatusSchema,
});
export type SkuDto = z.infer<typeof SkuDtoSchema>;

export const ProductListItemDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  basePrice: MoneyString,
  status: ProductStatusSchema,
  category: ProductCategoryRefSchema,
  primaryImage: ProductImageDtoSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type ProductListItemDto = z.infer<typeof ProductListItemDtoSchema>;

export const ProductDetailDtoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  basePrice: MoneyString,
  status: ProductStatusSchema,
  category: ProductCategoryRefSchema,
  images: z.array(ProductImageDtoSchema),
  variants: z.array(VariantDtoSchema),
  skus: z.array(SkuDtoSchema),
  createdAt: z.string().datetime(),
});
export type ProductDetailDto = z.infer<typeof ProductDetailDtoSchema>;

export const ProductListQuerySchema = z.object({
  categorySlug: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  cursor: z.string().min(1).max(64).optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

export const ProductListResponseSchema = z.object({
  items: z.array(ProductListItemDtoSchema),
  nextCursor: z.string().nullable(),
});
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;
