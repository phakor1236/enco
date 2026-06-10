import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  // Serial: all E2E specs share one dev DB, parallel writes would collide.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: WEB_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm -F @app/api dev',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      cwd: ROOT,
      timeout: 120_000,
      env: {
        ...process.env,
        // Prevent the 3/day/IP register rate-limit from exhausting under test retries.
        RATE_LIMIT_REGISTER_PER_DAY_PER_IP: '100',
      } as Record<string, string>,
    },
    {
      command: 'pnpm -F @app/web dev',
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      cwd: ROOT,
      timeout: 120_000,
    },
  ],
});
