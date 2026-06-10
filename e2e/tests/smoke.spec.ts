import { test, expect } from '../fixtures/index.js';

/**
 * T8.1 smoke — verifies both servers are reachable and the FE shell renders.
 * No DB state required; the hero section is static HTML.
 */
test.describe('smoke', () => {
  test('home page renders hero heading and shop CTA', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /made for the long way home/i, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: '逛全部商品' })).toBeVisible();
  });
});
