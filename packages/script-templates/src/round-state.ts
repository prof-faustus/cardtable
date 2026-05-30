/**
 * `round-state` template per `spec/script-templates.md` §2.7.
 *
 * Three branches:
 *   - Action: HASH256 successor template + acting player sig.
 *   - Timeout: CSV-gated + HASH256 timeout template + multisig (any of n).
 *   - Recovery: CLTV-gated + n-of-n multisig.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface RoundStateParams {
  readonly successor_template_hash: Hash256;
  readonly timeout_template_hash: Hash256;
  readonly acting_player_pubkey: Pubkey33;
  readonly seated_pubkeys: readonly Pubkey33[];
  readonly decision_timeout_blocks: number;
  readonly recovery_height: BlockHeight;
}

export function buildRoundStateScript(p: RoundStateParams): Uint8Array {
  if (p.seated_pubkeys.length === 0) {
    throw new Error('buildRoundStateScript: at least one seated pubkey required');
  }
  if (p.seated_pubkeys.length > 16) {
    throw new Error('buildRoundStateScript: seat count > 16 not supported in v1');
  }
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Action branch.
  w.op(OP.OP_HASH256);
  w.pushHash32(p.successor_template_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.acting_player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  // Timeout branch.
  w.pushNumber(p.decision_timeout_blocks);
  w.op(OP.OP_CHECKSEQUENCEVERIFY);
  w.op(OP.OP_DROP);
  w.op(OP.OP_HASH256);
  w.pushHash32(p.timeout_template_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);
  // Recovery branch.
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ENDIF);

  w.op(OP.OP_ENDIF);
  return w.bytes();
}
