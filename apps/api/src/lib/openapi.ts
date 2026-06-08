import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CategoryDtoSchema,
  LoginBody,
  ProductDetailDtoSchema,
  ProductImageDtoSchema,
  ProductListItemDtoSchema,
  ProductListResponseSchema,
  RegisterBody,
  SkuDtoSchema,
  VariantDtoSchema,
  VariantOptionDtoSchema,
} from '@app/shared';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorResponse');

const UserDto = z
  .object({
    id: z.string(),
    email: z.string().email(),
    role: z.enum(['CUSTOMER', 'ADMIN', 'SUPER_ADMIN']),
  })
  .openapi('UserDto');

const CartMergeResult = z
  .object({
    truncatedItems: z
      .array(
        z.object({
          skuId: z.string(),
          requested: z.number().int().positive(),
          granted: z.number().int().nonnegative(),
        }),
      )
      .describe('SKUs whose summed qty was clamped down to current stock'),
    droppedItems: z
      .array(
        z.object({
          skuId: z.string(),
          reason: z.enum(['INACTIVE', 'OUT_OF_STOCK']),
        }),
      )
      .describe('SKUs from the guest cart that were silently dropped during merge'),
  })
  .openapi('CartMergeResult');

const AuthSuccess = z
  .object({
    user: UserDto,
    accessToken: z.string().describe('JWT access token, 15 min TTL — store in memory only'),
    cartMergeResult: CartMergeResult.describe(
      'Guest-cart merge outcome — empty arrays when no guest cookie or nothing to merge',
    ),
  })
  .openapi('AuthSuccess');

const RegisterBodyOpen = RegisterBody.openapi('RegisterBody');
const LoginBodyOpen = LoginBody.openapi('LoginBody');

// Catalog DTOs — reuse the shared Zod schemas so doc and runtime contract
// stay in lockstep. The drift test in openapi.test.ts catches any miss.
const CategoryDto = CategoryDtoSchema.openapi('CategoryDto');
const CategoryListResponse = z
  .object({ items: z.array(CategoryDto) })
  .openapi('CategoryListResponse');
const ProductImageDto = ProductImageDtoSchema.openapi('ProductImageDto');
const VariantOptionDto = VariantOptionDtoSchema.openapi('VariantOptionDto');
const VariantDto = VariantDtoSchema.openapi('VariantDto');
const SkuDto = SkuDtoSchema.openapi('SkuDto');
const ProductListItemDto = ProductListItemDtoSchema.openapi('ProductListItemDto');
const ProductDetailDto = ProductDetailDtoSchema.openapi('ProductDetailDto');
const ProductListResponse = ProductListResponseSchema.openapi('ProductListResponse');

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const registry = new OpenAPIRegistry();

  registry.register('ErrorResponse', ErrorResponse);
  registry.register('UserDto', UserDto);
  registry.register('CartMergeResult', CartMergeResult);
  registry.register('AuthSuccess', AuthSuccess);
  registry.register('RegisterBody', RegisterBodyOpen);
  registry.register('LoginBody', LoginBodyOpen);
  registry.register('CategoryDto', CategoryDto);
  registry.register('CategoryListResponse', CategoryListResponse);
  registry.register('ProductImageDto', ProductImageDto);
  registry.register('VariantOptionDto', VariantOptionDto);
  registry.register('VariantDto', VariantDto);
  registry.register('SkuDto', SkuDto);
  registry.register('ProductListItemDto', ProductListItemDto);
  registry.register('ProductDetailDto', ProductDetailDto);
  registry.register('ProductListResponse', ProductListResponse);

  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: ErrorResponse } },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/register',
    tags: ['Auth'],
    summary: 'Register a new customer + auto-login',
    request: { body: { content: { 'application/json': { schema: RegisterBodyOpen } } } },
    responses: {
      201: {
        description: 'User created + access token issued + refresh cookie set',
        headers: {
          'Set-Cookie': {
            description: 'HttpOnly refresh cookie (vella_refresh)',
            schema: { type: 'string' },
          },
        },
        content: { 'application/json': { schema: AuthSuccess } },
      },
      400: errorResponse('VALIDATION_ERROR'),
      409: errorResponse('EMAIL_TAKEN'),
      429: errorResponse('RATE_LIMITED (3 registers / day / IP)'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Auth'],
    summary: 'Authenticate with email + password',
    request: { body: { content: { 'application/json': { schema: LoginBodyOpen } } } },
    responses: {
      200: {
        description: 'Access token issued + refresh cookie set',
        content: { 'application/json': { schema: AuthSuccess } },
      },
      400: errorResponse('VALIDATION_ERROR'),
      401: errorResponse('INVALID_CREDENTIALS'),
      429: errorResponse('RATE_LIMITED (5 logins / minute / IP)'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/refresh',
    tags: ['Auth'],
    summary: 'Rotate the refresh cookie + issue a fresh access token',
    description:
      'Reads vella_refresh cookie. On success the response Set-Cookie carries a new refresh ' +
      'value and the old one is revoked. Reuse of a stale token revokes the entire family.',
    responses: {
      200: { description: 'Rotated', content: { 'application/json': { schema: AuthSuccess } } },
      401: errorResponse('INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_REUSED'),
      409: errorResponse('TOKEN_RACED (concurrent rotation)'),
      429: errorResponse('RATE_LIMITED'),
    },
  });

  // -------------------------------------------------------------------------
  // Catalog (T2.4)
  // -------------------------------------------------------------------------

  registry.registerPath({
    method: 'get',
    path: '/api/categories',
    tags: ['Catalog'],
    summary: 'List all product categories (flat, sorted by name)',
    responses: {
      200: {
        description: 'All categories',
        content: { 'application/json': { schema: CategoryListResponse } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/products',
    tags: ['Catalog'],
    summary: 'List ACTIVE products with cursor pagination',
    description:
      "Filterable by category slug. `cursor` echoes the previous response's " +
      '`nextCursor`. A null nextCursor means the last page has been returned. ' +
      'A cursor pointing at a since-deleted product yields an empty page (not an error).',
    request: {
      query: z.object({
        categorySlug: z.string().min(1).max(80).optional().openapi({
          description: 'Restrict results to the given category slug',
          example: 'footwear',
        }),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(50)
          .default(12)
          .openapi({ description: 'Page size (1–50)', example: 12 }),
        cursor: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .openapi({ description: 'Opaque cursor from the previous response' }),
      }),
    },
    responses: {
      200: {
        description: 'Paginated product list',
        content: { 'application/json': { schema: ProductListResponse } },
      },
      400: errorResponse('VALIDATION_ERROR'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/products/{slug}',
    tags: ['Catalog'],
    summary: 'Get full product detail by slug',
    description:
      'Includes all images, variants, options, and ACTIVE SKUs. DRAFT or ' +
      'ARCHIVED products return 404 even when the slug matches a real row.',
    request: {
      params: z.object({
        slug: z.string().min(1).max(80).openapi({ example: 'classic-crew-tee' }),
      }),
    },
    responses: {
      200: {
        description: 'Product detail',
        content: { 'application/json': { schema: ProductDetailDto } },
      },
      400: errorResponse('VALIDATION_ERROR'),
      404: errorResponse('PRODUCT_NOT_FOUND'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout',
    tags: ['Auth'],
    summary: 'Revoke the current refresh token + clear cookie',
    description: 'Idempotent. Returns 204 even when no refresh cookie was sent.',
    responses: {
      204: { description: 'Logged out (or already logged out)' },
      429: errorResponse('RATE_LIMITED'),
    },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'VELLA E-commerce API',
      version: '0.1.0',
      description:
        'B2C single-seller e-commerce platform. Phase 1 covers authentication; ' +
        'catalog, cart, checkout, orders and admin are added in later slices.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local dev' }],
    tags: [
      { name: 'Auth', description: 'Registration + session management' },
      { name: 'Catalog', description: 'Public categories and products' },
    ],
  });
}
