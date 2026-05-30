/**
 * `card-custody` template per `spec/script-templates.md` §2.5.
 * Extended one-UTXO-per-card model only.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface CardCustodyParams {
  readonly face_commitment: Hash256;
  readonly holder_pubkey: Pubkey33;
  readonly original_funder_pubkey: Pubkey33;
  readonly recovery_height: BlockHeight;
}

export function buildCardCustodyScript(p: CardCustodyParams): Uint8Array {
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Reveal: face preimage + holder sig.
  w.op(OP.OP_HASH256);
  w.pushHash32(p.face_commitment);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.holder_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  w.op(OP.OP_IF);
  // Fold surrender — holder sig only.
  w.pushPubkey(p.holder_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  // CLTV recovery refund to original funder.
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.original_funder_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);
  w.op(OP.OP_ENDIF);
  return w.bytes();
}
