import { request as playwrightRequest } from '@playwright/test';

import { resetAndSeed } from '../fixtures/db.js';
import { test, expect } from '../fixtures/index.js';

/**
 * T8.4 — Admin shipping flow:
 * create paid order via API → login as superadmin → find PAID order in admin UI
 * → ship it (handle carrier/tracking prompts) → assert status "已出貨" → verify via API
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'testpass123';
const CARRIER = 'ShipEx';

test.describe('Admin shipping', () => {
  let orderId: string;
  // Unique per run — ShipmentMock.tracking_no has a DB-level unique constraint.
  const TRACKING = `TRK-E2E-${Date.now()}`;

  test.beforeAll(async () => {
    await resetAndSeed();

    const ctx = await playwrightRequest.newContext({ baseURL: API_URL });

    // ── 1. Register a fresh buyer ────────────────────────────────────────────
    const email = `e2e-admin-${Date.now()}@test.local`;
    const regRes = await ctx.post('/api/auth/register', {
      data: { email, password: PASSWORD },
    });
    if (!regRes.ok()) throw new Error(`Register failed: ${await regRes.text()}`);
    const { accessToken } = (await regRes.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    // ── 2. Fetch first in-stock SKU from stable seed product ─────────────────
    const productRes = await ctx.get('/api/products/classic-crew-tee');
    if (!productRes.ok()) throw new Error(`Product fetch failed: ${await productRes.text()}`);
    const product = (await productRes.json()) as { skus: { id: string; stock: number }[] };
    const sku = product.skus.find((s) => s.stock > 0);
    if (!sku) throw new Error('No in-stock SKU found on classic-crew-tee');

    // ── 3. Add to cart ───────────────────────────────────────────────────────
    const addRes = await ctx.post('/api/cart/items', {
      headers: auth,
      data: { skuId: sku.id, qty: 1 },
    });
    if (!addRes.ok()) throw new Error(`Add to cart failed: ${await addRes.text()}`);

    // ── 4. Checkout — AUTO_SUCCESS fires payment after ~300 ms ───────────────
    const checkoutRes = await ctx.post('/api/checkout', {
      headers: auth,
      data: {
        paymentMethod: 'credit_card',
        shippingAddress: {
          name: 'E2E Buyer',
          phone: '0912000001',
          city: '台北市',
          addr: '測試路1號',
        },
      },
    });
    if (!checkoutRes.ok()) throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
    orderId = ((await checkoutRes.json()) as { orderId: string }).orderId;

    // ── 5. Poll until PAID (payment mock fires 200–500 ms after response) ────
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const orderRes = await ctx.get(`/api/orders/${orderId}`, { headers: auth });
      if (!orderRes.ok()) break;
      const order = (await orderRes.json()) as { status: string };
      if (order.status === 'PAID') break;
    }

    await ctx.dispose();
  });

  test('ships a paid order and verifies status transitions to SHIPPED', async ({
    page,
    request,
  }) => {
    // ── 1. Login as superadmin (isDemoReadonly=false) ─────────────────────────
    await page.goto('/login');
    await page.getByLabel('電子信箱').fill('superadmin@example.com');
    await page.getByLabel(/密碼/).fill('admin1234');
    await page.getByRole('button', { name: '登入' }).click();
    await page.waitForURL('/');

    // ── 2. Admin orders page — show all orders so the row stays visible after
    //       status changes (filtering to PAID removes the row once shipped)
    await page.goto('/admin/orders');

    // ── 3. Find the order row created in beforeAll ────────────────────────────
    const orderPrefix = orderId.slice(0, 8);
    const orderRow = page.locator('tr', { hasText: orderPrefix });
    await expect(orderRow).toBeVisible({ timeout: 10_000 });
    // Confirm the order is in PAID status before shipping
    await expect(orderRow.getByText('已付款')).toBeVisible();

    // ── 4. Ship — mock window.prompt so dialogs resolve synchronously without
    //       CDP round-trips; the mutation still receives carrier + trackingNo.
    await page.evaluate(
      ([carrier, tracking]) => {
        let calls = 0;
        window.prompt = () => (++calls === 1 ? carrier : tracking);
      },
      [CARRIER, TRACKING],
    );

    // Intercept the ship API response to detect errors (mutation is fire-and-forget in UI).
    const [shipResponse] = await Promise.all([
      page.waitForResponse(
        (resp) => resp.url().includes('/ship') && resp.request().method() === 'POST',
        { timeout: 10_000 },
      ),
      orderRow.getByRole('button', { name: '出貨' }).click(),
    ]);
    expect(
      shipResponse.status(),
      `Ship API returned ${shipResponse.status()}: ${await shipResponse.text()}`,
    ).toBe(200);

    // ── 5. Status badge updates in-place to "已出貨" (row stays in "全部" view)
    await expect(orderRow.getByText('已出貨')).toBeVisible({ timeout: 10_000 });

    // ── 6. Verify via admin API: status + audit log (adminActionLog) ──────────
    const loginRes = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'superadmin@example.com', password: 'admin1234' },
    });
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    const orderRes = await request.get(`${API_URL}/api/admin/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(orderRes.ok()).toBeTruthy();
    const order = (await orderRes.json()) as {
      status: string;
      shipment?: { carrier: string; trackingNo: string };
    };
    expect(order.status).toBe('SHIPPED');
    expect(order.shipment?.carrier).toBe(CARRIER);
    expect(order.shipment?.trackingNo).toBe(TRACKING);
  });
});
