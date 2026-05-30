/**
 * `settle-claim` template per `spec/script-templates.md` §2.8.
 *
 * Single-branch: HASH256 settlement_commitment + winner sig.
 */

import type { Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface SettleClaimParams {
  readonly settlement_commitment: Hash256;
  readonly winner_pubkey: Pubkey33;
}

export function buildSettleClaimScript(p: SettleClaimParams): Uint8Array {
  const w = new ScriptWriter();
  w.op(OP.OP_HASH256);
  w.pushHash32(p.settlement_commitment);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.winner_pubkey);
  w.op(OP.OP_CHECKSIG);
  return w.bytes();
}
