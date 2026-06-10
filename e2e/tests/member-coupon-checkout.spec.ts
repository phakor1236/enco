import { request as playwrightRequest } from '@playwright/test';

import { resetAndSeed } from '../fixtures/db.js';
import { test, expect } from '../fixtures/index.js';

/**
 * T8.3 — Member checkout with coupon:
 * register → add item → apply FIXED-10 coupon → checkout → order success
 */

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'testpass123';
const SHIP = { name: 'E2E Member', phone: '0988765432', city: '台中市', addr: '中正路二段2號' };

const newEmail = (): string => `e2e-member-${Date.now()}@test.local`;

let couponCode: string;
let testEmail: string;

test.describe('Member checkout with coupon', () => {
  test.beforeAll(async () => {
    await resetAndSeed();

    // Create a FIXED-10 coupon as superadmin (isDemoReadonly=false).
    const ctx = await playwrightRequest.newContext({ baseURL: API_URL });

    const loginRes = await ctx.post('/api/auth/login', {
      data: { email: 'superadmin@example.com', password: 'admin1234' },
    });
    if (!loginRes.ok()) throw new Error(`Admin login failed: ${await loginRes.text()}`);
    const { accessToken } = (await loginRes.json()) as { accessToken: string };

    couponCode = `E2ECOUPON${Date.now()}`;
    const couponRes = await ctx.post('/api/admin/coupons', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { code: couponCode, type: 'FIXED', value: '10.00' },
    });
    if (!couponRes.ok()) throw new Error(`Coupon creation failed: ${await couponRes.text()}`);

    await ctx.dispose();

    // Fresh user — avoids cart-state pollution from previous runs.
    testEmail = newEmail();
  });

  test('registers, applies coupon, and completes checkout', async ({ page }) => {
    // ── 1. Register fresh user ────────────────────────────────────────────
    await page.goto('/register');
    await page.getByLabel('電子信箱').fill(testEmail);
    await page.getByLabel(/密碼/).fill(PASSWORD);
    await page.getByRole('button', { name: '建立帳號' }).click();
    await page.waitForURL('/');

    // ── 2. Add product to cart ───────────────────────────────────────────
    await page.goto('/product/classic-crew-tee');
    const addBtn = page.getByRole('button', { name: '加入購物車' });
    await expect(addBtn).toBeEnabled({ timeout: 10_000 });
    await addBtn.click();

    // ── 3. Cart drawer → proceed to checkout (member link) ───────────────
    const drawer = page.getByRole('dialog', { name: '購物車' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: '前往結帳' }).click();

    // ── 4. Apply coupon ───────────────────────────────────────────────────
    await page.waitForURL('/checkout');
    await expect(page.getByRole('button', { name: '確認送出' })).toBeEnabled({ timeout: 10_000 });

    await page.getByPlaceholder('輸入優惠碼').fill(couponCode);
    await page.getByRole('button', { name: '套用' }).click();
    // Applied coupon shows the code and discount amount.
    await expect(page.getByText(couponCode)).toBeVisible({ timeout: 5_000 });

    // ── 5. Fill shipping and submit ──────────────────────────────────────
    await page.getByLabel('收件人姓名').fill(SHIP.name);
    await page.getByLabel('手機號碼').fill(SHIP.phone);
    await page.getByLabel('縣市').fill(SHIP.city);
    await page.getByLabel('詳細地址').fill(SHIP.addr);
    await page.getByRole('button', { name: '確認送出' }).click();

    // ── 6. Order success ──────────────────────────────────────────────────
    await page.waitForURL(/\/orders\/success\//);
    await expect(page.getByRole('heading', { name: '訂單已建立！' })).toBeVisible();
  });
});
