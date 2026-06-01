/**
 * txid = double-SHA-256 of the canonical transaction bytes, reversed
 * for user-facing display.
 */

import type { BsvTransaction } from './types.js';
import { encodeBsvTransaction } from './encode.js';

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(input.byteLength);
  new Uint8Array(buf).set(input);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

/**
 * Compute the txid in **internal byte order** (the order embedded in
 * spending-tx prev_txid fields). For the human-facing reversed
 * representation, use `txidHex(tx)` instead.
 */
export async function computeTxId(tx: BsvTransaction): Promise<Uint8Array> {
  return sha256(await sha256(encodeBsvTransaction(tx)));
}

/** Reversed-hex display form, matching what block explorers show. */
export async function txidHex(tx: BsvTransaction): Promise<string> {
  const internal = await computeTxId(tx);
  const reversed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) reversed[i] = internal[31 - i]!;
  let s = '';
  for (const b of reversed) s += b.toString(16).padStart(2, '0');
  return s;
}
