/**
 * Pot accounting.
 *
 * Pure functions over satoshi amounts. No I/O, no clock.
 */

import type { Satoshis } from '@cardtable/protocol-types';
import { asSatoshis } from '@cardtable/protocol-types';

/**
 * Add `delta` satoshis to the pot. Both inputs must be non-negative.
 * Throws on overflow into unsafe-integer range.
 */
export function addToPot(pot: Satoshis, delta: Satoshis): Satoshis {
  const next = pot + delta;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`addToPot: pot overflow (${pot} + ${delta})`);
  }
  return asSatoshis(next);
}

/**
 * Subtract `delta` satoshis from the pot. Throws if delta exceeds pot.
 */
export function subtractFromPot(pot: Satoshis, delta: Satoshis): Satoshis {
  if (delta > pot) {
    throw new Error(`subtractFromPot: underflow (${pot} - ${delta})`);
  }
  return asSatoshis(pot - delta);
}
