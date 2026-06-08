import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { CART_COOKIE } from '../../src/routes/cart.js';
import { prisma } from '../../src/lib/db.js';
import { hashPassword, issueAccessToken } from '../../src/services/authService.js';

const app = createApp();

/**
 * T3.2 acceptance:
 *  - guest GET /cart auto-issues cart_session cookie
 *  - guest POST /cart/items works without auth
 *  - logged-in POST /cart/items routes through user_id branch (own cart)
 *  - exceeding stock → 409 OUT_OF_STOCK
 *  - PATCH and DELETE require the item to be on the caller's own cart
 *
 * Tests share the seeded catalog (loaded by globalSetup + earlier suite).
 * We pick a single ACTIVE SKU per case + reset its stock between cases so
 * concurrent test runs don't poison each other.
 */

let stockBackup: { id: string; stock: number };
let testSku: { id: string; stock: number };
let otherSku: { id: string };

beforeAll(async () => {
  const { seedCatalog } = await import('../../prisma/seed/products.js');
  await seedCatalog();
  const sku = await prisma.sku.findFirstOrThrow({
    where: { status: 'ACTIVE', stock: { gte: 10 } },
    select: { id: true, stock: true },
  });
  testSku = sku;
  stockBackup = sku;
  otherSku = await prisma.sku.findFirstOrThrow({
    where: { status: 'ACTIVE', id: { not: sku.id } },
    select: { id: true },
  });
});

afterEach(async () => {
  // Wipe any cart_items we touched during the test, restore stock baseline.
  await prisma.cartItem.deleteMany({ where: { skuId: { in: [testSku.id, otherSku.id] } } });
  await prisma.cart.deleteMany({
    where: { sessionId: { startsWith: 'cart-e2e-' }, OR: [{ items: { none: {} } }] },
  });
  await prisma.sku.update({ where: { id: stockBackup.id }, data: { stock: stockBackup.stock } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function parseCookieValue(
  setCookieHeader: string | string[] | undefined,
  name: string,
): string | null {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const cookie of arr) {
    const first = cookie.split(';')[0];
    const [k, ...rest] = (first ?? '').split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// ============================================================================
// Guest path
// ============================================================================

describe('GET /api/cart (guest)', () => {
  it('issues a cart_session cookie on first visit + returns an empty cart', async () => {
    const res = await request(app).get('/api/cart');
    expect(res.status).toBe(200);
    const sid = parseCookieValue(res.headers['set-cookie'], CART_COOKIE);
    expect(sid).toBeTruthy();
    expect(sid!.length).toBeGreaterThan(20);
    expect(res.body.items).toEqual([]);
    expect(res.body.itemCount).toBe(0);
    expect(res.body.subtotal).toBe('0.00');
  });

  it('subsequent visit reuses the existing cart_session cookie (no new one issued)', async () => {
    const first = await request(app).get('/api/cart');
    const sid = parseCookieValue(first.headers['set-cookie'], CART_COOKIE);
    const second = await request(app).get('/api/cart').set('Cookie', `${CART_COOKIE}=${sid}`);
    expect(second.status).toBe(200);
    // GET shouldn't bump the cookie (slideCookieTtl only fires on writes).
    expect(parseCookieValue(second.headers['set-cookie'], CART_COOKIE)).toBeNull();
  });
});

describe('POST /api/cart/items (guest)', () => {
  it('adds a SKU and returns the updated cart with computed subtotal', async () => {
    const res = await request(app).post('/api/cart/items').send({ skuId: testSku.id, qty: 2 });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].qty).toBe(2);
    expect(res.body.itemCount).toBe(2);
    expect(res.body.subtotal).toMatch(/^\d+\.\d{2}$/);
  });

  it('adding the same SKU again increments qty rather than creating a duplicate row', async () => {
    const sid = `cart-e2e-${Date.now()}`;
    const cookie = `${CART_COOKIE}=${sid}`;
    await request(app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ skuId: testSku.id, qty: 1 });
    const res = await request(app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ skuId: testSku.id, qty: 3 });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].qty).toBe(4);
  });

  it('exceeding SKU stock returns 409 OUT_OF_STOCK with available count', async () => {
    await prisma.sku.update({ where: { id: testSku.id }, data: { stock: 3 } });
    const res = await request(app).post('/api/cart/items').send({ skuId: testSku.id, qty: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    expect(res.body.error.details.available).toBe(3);
  });

  it('archiving the SKU makes subsequent adds return 409 SKU_INACTIVE', async () => {
    await prisma.sku.update({ where: { id: testSku.id }, data: { status: 'ARCHIVED' } });
    try {
      const res = await request(app).post('/api/cart/items').send({ skuId: testSku.id, qty: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SKU_INACTIVE');
    } finally {
      await prisma.sku.update({ where: { id: testSku.id }, data: { status: 'ACTIVE' } });
    }
  });

  it('rejects invalid body (qty 0) with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/cart/items').send({ skuId: testSku.id, qty: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('two concurrent adds for the same SKU sum qty without losing one (TOCTOU regression)', async () => {
    // Pre-fix flow read existing.qty THEN wrote newQty back; two parallel
    // add-N calls both computed N (because both saw qty=0) and one write
    // silently won, dropping the other. Atomic `increment` + tx fixes it.
    const sid = `cart-e2e-${Date.now()}-toctou`;
    const cookie = `${CART_COOKIE}=${sid}`;
    const [a, b] = await Promise.all([
      request(app)
        .post('/api/cart/items')
        .set('Cookie', cookie)
        .send({ skuId: testSku.id, qty: 3 }),
      request(app)
        .post('/api/cart/items')
        .set('Cookie', cookie)
        .send({ skuId: testSku.id, qty: 4 }),
    ]);
    expect([a.status, b.status]).toEqual(expect.arrayContaining([201, 201]));
    const final = await request(app).get('/api/cart').set('Cookie', cookie);
    expect(final.body.items).toHaveLength(1);
    expect(final.body.items[0].qty).toBe(7);
  });
});

// ============================================================================
// Patch / delete
// ============================================================================

describe('PATCH + DELETE /api/cart/items/:itemId', () => {
  it('PATCH updates qty + DELETE removes the item', async () => {
    const sid = `cart-e2e-${Date.now()}-pd`;
    const cookie = `${CART_COOKIE}=${sid}`;
    const add = await request(app)
      .post('/api/cart/items')
      .set('Cookie', cookie)
      .send({ skuId: testSku.id, qty: 2 });
    const itemId: string = add.body.items[0].id;

    const patched = await request(app)
      .patch(`/api/cart/items/${itemId}`)
      .set('Cookie', cookie)
      .send({ qty: 5 });
    expect(patched.status).toBe(200);
    expect(patched.body.items[0].qty).toBe(5);

    const removed = await request(app).delete(`/api/cart/items/${itemId}`).set('Cookie', cookie);
    expect(removed.status).toBe(200);
    expect(removed.body.items).toHaveLength(0);
  });

  it('PATCH a cart item that belongs to another cart returns 404 CART_ITEM_NOT_FOUND', async () => {
    const ownerSid = `cart-e2e-${Date.now()}-owner`;
    const attackerSid = `cart-e2e-${Date.now()}-attacker`;
    const add = await request(app)
      .post('/api/cart/items')
      .set('Cookie', `${CART_COOKIE}=${ownerSid}`)
      .send({ skuId: testSku.id, qty: 1 });
    const itemId: string = add.body.items[0].id;

    const res = await request(app)
      .patch(`/api/cart/items/${itemId}`)
      .set('Cookie', `${CART_COOKIE}=${attackerSid}`)
      .send({ qty: 2 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CART_ITEM_NOT_FOUND');
  });
});

// ============================================================================
// Member path
// ============================================================================

describe('Logged-in user (JWT) — cart routes through user_id branch', () => {
  it('member POST gets their own cart, not a guest cart, even if a cart_session cookie is present', async () => {
    const email = `cart-member-${Date.now()}@e2e-cart.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await hashPassword('x'.repeat(12)), role: 'CUSTOMER' },
    });
    try {
      const accessToken = issueAccessToken(user);

      const res = await request(app)
        .post('/api/cart/items')
        .set('Authorization', `Bearer ${accessToken}`)
        // Send a guest cookie too — the route must ignore it because user is set.
        .set('Cookie', `${CART_COOKIE}=should-not-be-used`)
        .send({ skuId: testSku.id, qty: 2 });
      expect(res.status).toBe(201);

      // Verify cart on DB is owned by user_id, not by the bogus session_id.
      const memberCart = await prisma.cart.findFirst({ where: { userId: user.id } });
      expect(memberCart).toBeTruthy();
      const ghostCart = await prisma.cart.findFirst({
        where: { sessionId: 'should-not-be-used' },
      });
      expect(ghostCart).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
