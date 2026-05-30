/**
 * `pot-lock` template per `spec/script-templates.md` §2.3.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface PotLockParams {
  readonly seated_pubkeys: readonly Pubkey33[];
  readonly winner_proof_hash: Hash256;
  readonly winner_pubkey: Pubkey33;
  readonly refund_pubkey: Pubkey33;
  readonly recovery_height: BlockHeight;
}

export function buildPotLockScript(p: PotLockParams): Uint8Array {
  if (p.seated_pubkeys.length === 0) {
    throw new Error('buildPotLockScript: at least one pubkey required');
  }
  if (p.seated_pubkeys.length > 16) {
    throw new Error('buildPotLockScript: seat count > 16 not supported in v1');
  }
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  w.op(OP.OP_SHA256);
  w.pushHash32(p.winner_proof_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.winner_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.refund_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);

  w.op(OP.OP_ENDIF);
  return w.bytes();
}
