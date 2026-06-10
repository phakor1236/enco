import { request as playwrightRequest } from '@playwright/test';

import { resetAndSeed } from '../fixtures/db.js';
import { test, expect } from '../fixtures/index.js';

/**
 * T8.9 — Payment failure path:
 * checkout with AUTO_FAILURE → order success page shows "訂單已取消" → stock restored.
 *
 * The UI form does not expose outcomeMode, so the order is created via API in
 * beforeAll with outcomeMode='AUTO_FAILURE'. The browser navigates to the
 * success page (which polls every 1.5 s) and verifies the cancellation copy.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'testpass123';

test.describe('Payment failure path', () => {
  let orderId: string;
  let skuId: string;
  let stockBefore: number;
  let buyerEmail: string;

  test.beforeAll(async () => {
    await resetAndSeed();

    const ctx = await playwrightRequest.newContext({ baseURL: API_URL });

    // ── 1. Register fresh buyer ──────────────────────────────────────────────
    buyerEmail = `e2e-failure-${Date.now()}@test.local`;
    const regRes = await ctx.post('/api/auth/register', {
      data: { email: buyerEmail, password: PASSWORD },
    });
    if (!regRes.ok()) throw new Error(`Register failed: ${await regRes.text()}`);
    const { accessToken } = (await regRes.json()) as { accessToken: string };
    const auth = { Authorization: `Bearer ${accessToken}` };

    // ── 2. Get first in-stock SKU and record initial stock ───────────────────
    const productRes = await ctx.get('/api/products/classic-crew-tee');
    if (!productRes.ok()) throw new Error(`Product fetch failed: ${await productRes.text()}`);
    const product = (await productRes.json()) as { skus: { id: string; stock: number }[] };
    const sku = product.skus.find((s) => s.stock > 0);
    if (!sku) throw new Error('No in-stock SKU found on classic-crew-tee');
    skuId = sku.id;
    stockBefore = sku.stock;

    // ── 3. Add to cart ───────────────────────────────────────────────────────
    const addRes = await ctx.post('/api/cart/items', {
      headers: auth,
      data: { skuId, qty: 1 },
    });
    if (!addRes.ok()) throw new Error(`Add to cart failed: ${await addRes.text()}`);

    // ── 4. Checkout with AUTO_FAILURE — payment sim transitions to CANCELLED ─
    const checkoutRes = await ctx.post('/api/checkout', {
      headers: auth,
      data: {
        paymentMethod: 'mock_card',
        outcomeMode: 'AUTO_FAILURE',
        shippingAddress: {
          name: 'E2E Failure',
          phone: '0912000002',
          city: '台北市',
          addr: '測試路2號',
        },
      },
    });
    if (!checkoutRes.ok()) throw new Error(`Checkout failed: ${await checkoutRes.text()}`);
    orderId = ((await checkoutRes.json()) as { orderId: string }).orderId;

    await ctx.dispose();
  });

  test('order success page shows cancellation and stock is restored', async ({ page, request }) => {
    // ── 1. Login as the buyer — OrderSuccessPage calls GET /api/orders/:id ───
    await page.goto('/login');
    await page.getByLabel('電子信箱').fill(buyerEmail);
    await page.getByLabel(/密碼/).fill(PASSWORD);
    await page.getByRole('button', { name: '登入' }).click();
    await page.waitForURL('/');

    // ── 2. Navigate to the order success page ────────────────────────────────
    await page.goto(`/orders/success/${orderId}`);
    await expect(page.getByRole('heading', { name: '訂單已建立！' })).toBeVisible();

    // ── 3. Page polls every 1500 ms while PENDING — wait for CANCELLED copy ─
    // Payment sim fires 200–500 ms post-checkout; total wait < 3 s normally.
    await expect(page.getByText('訂單已取消，款項不會扣除')).toBeVisible({ timeout: 10_000 });

    // ── 4. Verify stock restored (public product endpoint, no auth needed) ───
    const productRes = await request.get(`${API_URL}/api/products/classic-crew-tee`);
    const product = (await productRes.json()) as { skus: { id: string; stock: number }[] };
    const sku = product.skus.find((s) => s.id === skuId);
    expect(sku?.stock, 'SKU stock should be restored after CANCELLED').toBe(stockBefore);

    // ── 5. Verify order status via admin API ──────────────────────────────────
    const loginRes = await request.post(`${API_URL}/api/auth/login`, {
      data: { email: 'superadmin@example.com', password: 'admin1234' },
    });
    expect(loginRes.ok(), `Admin login failed: ${await loginRes.text()}`).toBeTruthy();
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    const orderRes = await request.get(`${API_URL}/api/admin/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(orderRes.ok()).toBeTruthy();
    expect(((await orderRes.json()) as { status: string }).status).toBe('CANCELLED');
  });
});
