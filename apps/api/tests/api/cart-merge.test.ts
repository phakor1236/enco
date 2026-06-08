import { randomBytes } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';
import { CART_COOKIE } from '../../src/routes/cart.js';
import * as cartService from '../../src/services/cartService.js';

const app = createApp();

/**
 * T3.3 acceptance — guest cart merges into member cart on login + register:
 *  - same SKU on both sides → qty sums
 *  - sum exceeds stock → clamp to stock, surface in `truncatedItems`
 *  - ARCHIVED SKU → silently dropped, surface in `droppedItems`
 *  - guest cart row deleted after merge
 *  - cart_session cookie cleared on the auth response
 *  - merge failure must not block login (vi.spyOn forces a throw)
 */

const EMAIL_DOMAIN = 'e2e-merge.test';
function newEmail(label = ''): string {
  return `${label}-${randomBytes(4).toString('hex')}@${EMAIL_DOMAIN}`;
}
function newIp(): string {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

let skuA: { id: string; stock: number };
let skuB: { id: string; stock: number };

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();
  const [a, b] = await prisma.sku.findMany({
    where: { status: 'ACTIVE', stock: { gte: 10 } },
    select: { id: true, stock: true },
    take: 2,
  });
  if (!a || !b) throw new Error('seed must produce ≥ 2 ACTIVE SKUs with stock ≥ 10');
  skuA = a;
  skuB = b;
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await prisma.cart.deleteMany({
    where: { OR: [{ sessionId: { startsWith: 'cart-merge-e2e-' } }, { user: null }] },
  });
  // Reset stock + status touched during the run.
  await prisma.sku.update({
    where: { id: skuA.id },
    data: { stock: skuA.stock, status: 'ACTIVE' },
  });
  await prisma.sku.update({
    where: { id: skuB.id },
    data: { stock: skuB.stock, status: 'ACTIVE' },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function parseSetCookie(header: string | string[] | undefined): Array<Record<string, string>> {
  if (!header) return [];
  const arr = Array.isArray(header) ? header : [header];
  return arr.map((cookie) => {
    const parts = cookie.split(';').map((p) => p.trim());
    const out: Record<string, string> = {};
    const [first, ...attrs] = parts;
    const [name, ...vrest] = (first ?? '').split('=');
    if (name) out.name = name;
    out.value = vrest.join('=');
    for (const a of attrs) {
      const [k, ...vp] = a.split('=');
      if (k) out[k.toLowerCase()] = vp.join('=') || 'true';
    }
    return out;
  });
}

async function seedGuestCart(items: Array<{ skuId: string; qty: number }>): Promise<string> {
  const sid = `cart-merge-e2e-${randomBytes(4).toString('hex')}`;
  const cart = await prisma.cart.create({ data: { sessionId: sid } });
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.cartItem.create({ data: { cartId: cart.id, skuId: item.skuId, qty: item.qty } });
  }
  return sid;
}

async function registerWithCookie(
  cookieHeader: string | undefined,
  email: string,
  password = 'password123',
): Promise<request.Response> {
  let req = request(app).post('/api/auth/register').set('X-Forwarded-For', newIp());
  if (cookieHeader) req = req.set('Cookie', cookieHeader);
  return req.send({ email, password });
}

async function loginWithCookie(
  cookieHeader: string | undefined,
  email: string,
  password = 'password123',
): Promise<request.Response> {
  let req = request(app).post('/api/auth/login').set('X-Forwarded-For', newIp());
  if (cookieHeader) req = req.set('Cookie', cookieHeader);
  return req.send({ email, password });
}

// ============================================================================
// /register
// ============================================================================

describe('POST /api/auth/register — guest cart merge', () => {
  it('returns an empty cartMergeResult when no cart_session cookie was sent', async () => {
    const res = await registerWithCookie(undefined, newEmail('no-cookie'));
    expect(res.status).toBe(201);
    expect(res.body.cartMergeResult).toEqual({ truncatedItems: [], droppedItems: [] });
  });

  it("moves a guest cart's items into the new user's cart + deletes the guest cart", async () => {
    const sid = await seedGuestCart([
      { skuId: skuA.id, qty: 2 },
      { skuId: skuB.id, qty: 1 },
    ]);
    const email = newEmail('move');
    const res = await registerWithCookie(`${CART_COOKIE}=${sid}`, email);
    expect(res.status).toBe(201);
    expect(res.body.cartMergeResult).toEqual({ truncatedItems: [], droppedItems: [] });

    // Guest cart row gone.
    const remaining = await prisma.cart.findFirst({ where: { sessionId: sid } });
    expect(remaining).toBeNull();

    // Member cart has exactly the two items at the original quantities.
    const memberCart = await prisma.cart.findFirstOrThrow({
      where: { user: { email } },
      include: { items: { orderBy: { skuId: 'asc' } } },
    });
    const byId = new Map(memberCart.items.map((i) => [i.skuId, i.qty]));
    expect(byId.get(skuA.id)).toBe(2);
    expect(byId.get(skuB.id)).toBe(1);

    // Cart cookie cleared so the next FE request doesn't accidentally
    // re-mint a guest cart on top of the member one.
    const cleared = parseSetCookie(res.headers['set-cookie']).find((c) => c.name === CART_COOKIE);
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe('');
  });
});

// ============================================================================
// /login
// ============================================================================

describe('POST /api/auth/login — guest cart merge', () => {
  async function registerThenSeedGuest(
    items: Array<{ skuId: string; qty: number }>,
    label = 'login',
  ): Promise<{ email: string; sid: string }> {
    const email = newEmail(label);
    const reg = await registerWithCookie(undefined, email);
    expect(reg.status).toBe(201);
    const sid = await seedGuestCart(items);
    return { email, sid };
  }

  async function seedMemberCart(
    email: string,
    items: Array<{ skuId: string; qty: number }>,
  ): Promise<{ id: string }> {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const cart = await prisma.cart.create({ data: { userId: user.id } });
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.cartItem.create({
        data: { cartId: cart.id, skuId: item.skuId, qty: item.qty },
      });
    }
    return cart;
  }

  it('sums qty when guest and member carts share a SKU', async () => {
    const { email, sid } = await registerThenSeedGuest([{ skuId: skuA.id, qty: 3 }], 'conflict');
    const memberCart = await seedMemberCart(email, [{ skuId: skuA.id, qty: 2 }]);

    const res = await loginWithCookie(`${CART_COOKIE}=${sid}`, email);
    expect(res.status).toBe(200);
    expect(res.body.cartMergeResult).toEqual({ truncatedItems: [], droppedItems: [] });

    const after = await prisma.cartItem.findFirstOrThrow({
      where: { cartId: memberCart.id, skuId: skuA.id },
    });
    expect(after.qty).toBe(5);
  });

  it('truncates to stock when guest + member qty exceeds it', async () => {
    const { email, sid } = await registerThenSeedGuest([{ skuId: skuA.id, qty: 6 }], 'trunc');
    const memberCart = await seedMemberCart(email, [{ skuId: skuA.id, qty: 3 }]);

    // Cap stock below the would-be sum (6 + 3 = 9 → clamped to 7).
    await prisma.sku.update({ where: { id: skuA.id }, data: { stock: 7 } });

    const res = await loginWithCookie(`${CART_COOKIE}=${sid}`, email);
    expect(res.status).toBe(200);
    expect(res.body.cartMergeResult.droppedItems).toEqual([]);
    expect(res.body.cartMergeResult.truncatedItems).toEqual([
      { skuId: skuA.id, requested: 9, granted: 7 },
    ]);

    const after = await prisma.cartItem.findFirstOrThrow({
      where: { cartId: memberCart.id, skuId: skuA.id },
    });
    expect(after.qty).toBe(7);
  });

  it('silently drops ARCHIVED SKUs while other items still merge', async () => {
    const { email, sid } = await registerThenSeedGuest(
      [
        { skuId: skuA.id, qty: 2 },
        { skuId: skuB.id, qty: 1 },
      ],
      'drop',
    );
    await prisma.sku.update({ where: { id: skuB.id }, data: { status: 'ARCHIVED' } });

    const res = await loginWithCookie(`${CART_COOKIE}=${sid}`, email);
    expect(res.status).toBe(200);
    expect(res.body.cartMergeResult.truncatedItems).toEqual([]);
    expect(res.body.cartMergeResult.droppedItems).toEqual([{ skuId: skuB.id, reason: 'INACTIVE' }]);

    const memberCart = await prisma.cart.findFirstOrThrow({
      where: { user: { email } },
      include: { items: true },
    });
    const ids = memberCart.items.map((i) => i.skuId);
    expect(ids).toContain(skuA.id);
    expect(ids).not.toContain(skuB.id);
  });

  it('login still succeeds (200) when no guest cookie is sent — merge result empty', async () => {
    const email = newEmail('nocookie');
    await registerWithCookie(undefined, email);
    const res = await loginWithCookie(undefined, email);
    expect(res.status).toBe(200);
    expect(res.body.cartMergeResult).toEqual({ truncatedItems: [], droppedItems: [] });
  });

  it('login still succeeds (200) when the guest cart referenced by the cookie does not exist', async () => {
    const email = newEmail('ghost');
    await registerWithCookie(undefined, email);
    const res = await loginWithCookie(`${CART_COOKIE}=cart-merge-e2e-ghost-sid`, email);
    expect(res.status).toBe(200);
    expect(res.body.cartMergeResult).toEqual({ truncatedItems: [], droppedItems: [] });
  });

  it('login still succeeds with empty cartMergeResult when mergeGuestCart throws', async () => {
    // Forces the catch path in performGuestCartMerge — per SPEC §5 a merge
    // failure must log + flag the response but never block auth. ESM named
    // imports are live bindings, so spying on the cartService namespace
    // intercepts the route's reference to mergeGuestCart.
    const { email, sid } = await registerThenSeedGuest([{ skuId: skuA.id, qty: 2 }], 'mergefail');
    const spy = vi
      .spyOn(cartService, 'mergeGuestCart')
      .mockRejectedValueOnce(new Error('forced merge failure'));
    try {
      const res = await loginWithCookie(`${CART_COOKIE}=${sid}`, email);
      expect(res.status).toBe(200);
      expect(res.body.cartMergeResult).toEqual({ truncatedItems: [], droppedItems: [] });
      expect(typeof res.body.accessToken).toBe('string');
      expect(spy).toHaveBeenCalledOnce();
      // The cookie is still cleared so subsequent requests don't re-attempt
      // against the same (presumed-broken) guest session.
      const cleared = parseSetCookie(res.headers['set-cookie']).find((c) => c.name === CART_COOKIE);
      expect(cleared?.value).toBe('');
    } finally {
      spy.mockRestore();
    }
  });
});
