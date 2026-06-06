import { Router, type Request, type Response, type Router as RouterType } from 'express';
import { AddCartItemBody, UpdateCartItemBody } from '@app/shared';

import { prisma } from '../lib/db.js';
import { optionalAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  addItem,
  getCart,
  newGuestSessionId,
  removeItem,
  updateItem,
  type CartOwner,
} from '../services/cartService.js';

export const CART_COOKIE = 'cart_session';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function cartCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: SEVEN_DAYS_MS,
  };
}

/**
 * Resolve the cart owner from the request. JWT-attached user wins; otherwise
 * we fall back to the cart_session cookie. If neither exists (a guest's very
 * first cart write), `ensureGuestSession` mints a fresh sessionId and writes
 * the cookie — that path is GET-or-create on /cart and additionally fires
 * on POST /cart/items.
 *
 * Why not require auth: SPEC §5 — guests can browse, add, and even
 * "view their cart" before registering. Login then merges (T3.3).
 */
function readOwner(req: Request): { owner: CartOwner } | { needsNewSession: true } {
  if (req.user) {
    return { owner: { userId: req.user.id } };
  }
  const existing = req.cookies?.[CART_COOKIE];
  if (typeof existing === 'string' && existing.length > 0) {
    return { owner: { sessionId: existing } };
  }
  return { needsNewSession: true };
}

function ensureGuestSession(req: Request, res: Response): { owner: CartOwner } {
  const resolved = readOwner(req);
  if ('owner' in resolved) return resolved;
  const sessionId = newGuestSessionId();
  res.cookie(CART_COOKIE, sessionId, cartCookieOptions());
  return { owner: { sessionId } };
}

function slideCookieTtl(req: Request, res: Response): void {
  // Per SPEC §5 sliding TTL — every cart write extends the cookie another
  // 7 days. Same value, fresh maxAge.
  const sid = req.cookies?.[CART_COOKIE];
  if (typeof sid === 'string' && sid.length > 0 && !req.user) {
    res.cookie(CART_COOKIE, sid, cartCookieOptions());
  }
}

// ---------------------------------------------------------------------------

export const cartRouter: RouterType = Router();

// Every cart route reads JWT-if-present so logged-in callers route through
// the user_id branch instead of accidentally getting a guest cart.
cartRouter.use(optionalAuth);

cartRouter.get('/', async (req, res, next) => {
  try {
    const { owner } = ensureGuestSession(req, res);
    const cart = await getCart(prisma, owner);
    res.json(cart);
  } catch (e) {
    next(e);
  }
});

cartRouter.post('/items', validateBody(AddCartItemBody), async (req, res, next) => {
  try {
    const { owner } = ensureGuestSession(req, res);
    const cart = await addItem(prisma, owner, req.body as AddCartItemBody);
    slideCookieTtl(req, res);
    res.status(201).json(cart);
  } catch (e) {
    next(e);
  }
});

cartRouter.patch<{ itemId: string }>(
  '/items/:itemId',
  validateBody(UpdateCartItemBody),
  async (req, res, next) => {
    try {
      const { owner } = ensureGuestSession(req, res);
      const cart = await updateItem(
        prisma,
        owner,
        req.params.itemId,
        (req.body as UpdateCartItemBody).qty,
      );
      slideCookieTtl(req, res);
      res.json(cart);
    } catch (e) {
      next(e);
    }
  },
);

cartRouter.delete<{ itemId: string }>('/items/:itemId', async (req, res, next) => {
  try {
    const { owner } = ensureGuestSession(req, res);
    const cart = await removeItem(prisma, owner, req.params.itemId);
    slideCookieTtl(req, res);
    res.json(cart);
  } catch (e) {
    next(e);
  }
});
