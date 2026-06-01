/**
 * Online-mode browser smoke test.
 *
 * Loads the React client from the Vite preview server, clicks the
 * "Connect to relay" button (default URL `ws://localhost:8081/ws`),
 * then exercises the network-backed Zustand path:
 *   - Connection mode flips offline → connecting → online.
 *   - Clicking "Seat seat 0" submits a Join to the relay; the
 *     server pushes MsgTableState; the UI mirrors `seat-count = 1`.
 *
 * Self-skips unless CARDTABLE_RUN_ONLINE_BROWSER=1. The CI driver
 * starts a fresh Go relay on :8081 before running this suite so
 * the relay's session is at S1_SEAT_OPEN with no prior actions.
 */

import { expect, test } from '@playwright/test';

const RUN = process.env['CARDTABLE_RUN_ONLINE_BROWSER'] === '1';

test.skip(!RUN, 'set CARDTABLE_RUN_ONLINE_BROWSER=1 with a fresh relay running on :8081');

test('online mode: connect → seat 0 → state mirrors over WebSocket', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('connection-mode')).toHaveText('offline');
  await expect(page.getByTestId('seat-count')).toHaveText('0');

  await page.getByRole('button', { name: 'Connect to relay' }).click();
  // Expect the indicator to land on 'online' within the per-step timeout.
  await expect(page.getByTestId('connection-mode')).toHaveText('online');

  await page.getByRole('button', { name: 'Seat seat 0' }).click();
  // The relay's MsgTableState push arrives asynchronously; the
  // store's handleFrame overwrites store.state with the parsed
  // server-side state, so seat-count should flip to 1.
  await expect(page.getByTestId('seat-count')).toHaveText('1');
});
