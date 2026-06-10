import { resetAndSeed } from '../fixtures/db.js';
import { test, expect } from '../fixtures/index.js';

/**
 * T8.2 — Guest checkout flow:
 * home → product detail → add to cart (guest) → register → checkout → order success
 */

const PASSWORD = 'testpass123';
const SHIP = { name: 'E2E Test', phone: '0912345678', city: '台北市', addr: '測試路一段1號' };

// Unique per run so re-runs never hit EMAIL_TAKEN.
const email = (): string => `e2e-guest-${Date.now()}@test.local`;

test.describe('Guest checkout', () => {
  test.beforeAll(async () => {
    await resetAndSeed(); // ensure catalog is seeded
  });

  test('adds item as guest, registers, and completes order', async ({ page }) => {
    // ── 1. Product detail ────────────────────────────────────────────────
    // Navigate directly to a deterministic seeded product (slug stable across runs).
    await page.goto('/product/classic-crew-tee');

    // VariantPicker auto-selects the first Size option → button becomes enabled.
    const addBtn = page.getByRole('button', { name: '加入購物車' });
    await expect(addBtn).toBeEnabled({ timeout: 10_000 });
    await addBtn.click();

    // ── 2. Cart drawer ───────────────────────────────────────────────────
    // Drawer opens automatically after successful add mutation.
    const drawer = page.getByRole('dialog', { name: '購物車' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Classic Crew Tee')).toBeVisible();

    // Guest CTA links to login, not checkout.
    const loginCta = drawer.getByRole('link', { name: '請先登入再結帳' });
    await expect(loginCta).toBeVisible();
    await loginCta.click();

    // ── 3. Register ──────────────────────────────────────────────────────
    await page.waitForURL('/login');
    await page.getByRole('link', { name: '立即註冊' }).click();

    await page.waitForURL('/register');
    await page.getByLabel('電子信箱').fill(email());
    await page.getByLabel(/密碼/).fill(PASSWORD);
    await page.getByRole('button', { name: '建立帳號' }).click();

    // ── 4. Checkout ──────────────────────────────────────────────────────
    // After register, FE navigates to /. Guest cart is merged server-side.
    await page.waitForURL('/');
    await page.goto('/checkout');

    // Wait for cart to hydrate: submit button is disabled while cartLoading or isEmpty.
    const submitBtn = page.getByRole('button', { name: '確認送出' });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });

    await page.getByLabel('收件人姓名').fill(SHIP.name);
    await page.getByLabel('手機號碼').fill(SHIP.phone);
    await page.getByLabel('縣市').fill(SHIP.city);
    await page.getByLabel('詳細地址').fill(SHIP.addr);
    await submitBtn.click();

    // ── 5. Order success ─────────────────────────────────────────────────
    await page.waitForURL(/\/orders\/success\//);
    await expect(page.getByRole('heading', { name: '訂單已建立！' })).toBeVisible();
  });
});
