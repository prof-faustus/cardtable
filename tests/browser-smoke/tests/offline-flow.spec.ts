/**
 * Offline-mode browser smoke test.
 *
 * Loads the React client from the Vite preview server (no relay
 * required) and exercises the in-process state-engine path:
 *   - Initial state shows S1_SEAT_OPEN.
 *   - Clicking "Seat seat 0" increments the player count.
 *   - Clicking "Seat seat 1" increments again, then "Lock table"
 *     advances to S3_ENTROPY_COMMIT_WINDOW.
 *
 * This is the cheapest possible browser-level regression check: it
 * proves the App.tsx + Zustand store render and bind correctly in
 * a real Chromium, without needing a backend.
 */

import { expect, test } from '@playwright/test';

test('offline mode: two joins → lock → S3', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('state-class')).toHaveText('S1_SEAT_OPEN');
  await expect(page.getByTestId('seat-count')).toHaveText('0');
  await expect(page.getByTestId('connection-mode')).toHaveText('offline');

  await page.getByRole('button', { name: 'Seat seat 0' }).click();
  await expect(page.getByTestId('seat-count')).toHaveText('1');

  await page.getByRole('button', { name: 'Seat seat 1' }).click();
  await expect(page.getByTestId('seat-count')).toHaveText('2');

  await page.getByRole('button', { name: 'Lock table' }).click();
  await expect(page.getByTestId('state-class')).toHaveText('S3_ENTROPY_COMMIT_WINDOW');
});

test('offline mode: reset restores the empty state', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Seat seat 0' }).click();
  await expect(page.getByTestId('seat-count')).toHaveText('1');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('seat-count')).toHaveText('0');
  await expect(page.getByTestId('state-class')).toHaveText('S1_SEAT_OPEN');
});
