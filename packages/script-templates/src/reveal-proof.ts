/**
 * Reveal proof script support.
 *
 * The reveal proof itself is data (carried in `OP_RETURN` metadata of a
 * CardReveal tx); on-chain verification happens inside the consumed
 * output's locking script. This module provides a helper for building
 * a standalone reveal-verification script — useful for unit testing the
 * preimage-binding semantics in isolation.
 */

import type { Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface RevealProofParams {
  /** HASH256 commitment to the (ordinal || card_nonce || deck_nonce) tuple. */
  readonly card_commitment: Hash256;
  /** Required signer (typically the revealing player). */
  readonly signer_pubkey: Pubkey33;
}

/**
 * Build a locking script that:
 *   1. Consumes a preimage from the stack.
 *   2. Verifies HASH256(preimage) == card_commitment.
 *   3. Verifies a signature from signer_pubkey.
 *
 * Useful for testing reveal binding apart from the larger
 * `card-custody` / `round-state` script bodies.
 */
export function buildRevealProofScript(p: RevealProofParams): Uint8Array {
  const w = new ScriptWriter();
  w.op(OP.OP_HASH256);
  w.pushHash32(p.card_commitment);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.signer_pubkey);
  w.op(OP.OP_CHECKSIG);
  return w.bytes();
}
