/**
 * `stake-lock` template per `spec/script-templates.md` §2.2.
 *
 * Three exits: cooperative settle (player + operator), winner claim,
 * CLTV-gated refund.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface StakeLockParams {
  readonly player_pubkey: Pubkey33;
  readonly operator_pubkey: Pubkey33;
  /** SHA-256-of-SHA-256 commitment to the expected settlement preimage. */
  readonly expected_settlement_hash: Hash256;
  /** CLTV refund height. */
  readonly recovery_height: BlockHeight;
}

/** Build the canonical bytes of a `stake-lock` locking script. */
export function buildStakeLockScript(p: StakeLockParams): Uint8Array {
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Cooperative settle: 2-of-2 player + operator.
  w.pushNumber(2);
  w.pushPubkey(p.player_pubkey);
  w.pushPubkey(p.operator_pubkey);
  w.pushNumber(2);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  // Winner claim: HASH256 preimage check + player sig.
  w.op(OP.OP_HASH256);
  w.pushHash32(p.expected_settlement_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  // Refund: CLTV-gated player signature.
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);

  w.op(OP.OP_ENDIF);
  return w.bytes();
}
