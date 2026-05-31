import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the browser smoke suite.
 *
 * - Headless Chromium only (the suite is for build-gate smoke, not
 *   visual regression across browsers).
 * - 30s per test ceiling so a hung WebSocket connect fails fast
 *   rather than burning the workflow timeout.
 * - The Vite preview server URL is consumed via env var
 *   CARDTABLE_CLIENT_URL so CI can swap between dev and prod
 *   builds without changing config.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // tests share a backing relay
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env['CARDTABLE_CLIENT_URL'] ?? 'http://localhost:4173',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  timeout: 30_000,
});
