import { Router, type Router as RouterType } from 'express';
import { ProductListQuerySchema } from '@app/shared';

import { AppError } from '../lib/errors.js';
import { validateQuery } from '../middleware/validate.js';
import { getProductBySlug, listCategories, listProducts } from '../services/productService.js';

export const categoriesRouter: RouterType = Router();
export const productsRouter: RouterType = Router();

// ---------------------------------------------------------------------------
// GET /api/categories  — flat list, sorted alpha
// ---------------------------------------------------------------------------

categoriesRouter.get('/', async (_req, res, next) => {
  try {
    const items = await listCategories();
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/products  — cursor-paginated, optional category filter
// ---------------------------------------------------------------------------

productsRouter.get('/', validateQuery(ProductListQuerySchema), async (req, res, next) => {
  try {
    const query = (req as unknown as { validatedQuery: typeof ProductListQuerySchema._type })
      .validatedQuery;
    const result = await listProducts(query);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /api/products/:slug  — full detail with variants/SKUs/images
// ---------------------------------------------------------------------------

productsRouter.get('/:slug', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    // Defense in depth — slug already pattern-checked by router but reject
    // empty / over-long input before hitting the DB.
    if (!slug || slug.length > 80) {
      throw new AppError('VALIDATION_ERROR', 'Invalid slug', 400);
    }
    const product = await getProductBySlug(slug);
    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND', `No active product with slug "${slug}"`, 404);
    }
    res.json(product);
  } catch (e) {
    next(e);
  }
});
