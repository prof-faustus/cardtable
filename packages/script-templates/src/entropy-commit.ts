/**
 * `entropy-commit` template per `spec/script-templates.md` §2.4.
 *
 * Reveal branch: spender provides entropy plaintext; script checks
 *   SHA-256(plaintext) == commitment_hash and a player signature.
 *
 * Timeout branch: after CSV-relative `decision_timeout_blocks`,
 *   - cooperative fallback: m-of-(n-1) of the other players;
 *   - CLTV-gated player refund.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface EntropyCommitParams {
  readonly commitment_hash: Hash256;
  readonly player_pubkey: Pubkey33;
  readonly other_pubkeys: readonly Pubkey33[];
  readonly decision_timeout_blocks: number;
  readonly recovery_height: BlockHeight;
}

export function buildEntropyCommitScript(p: EntropyCommitParams): Uint8Array {
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Reveal branch.
  w.op(OP.OP_SHA256);
  w.pushHash32(p.commitment_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);

  w.op(OP.OP_ELSE);
  // Timeout outer branch: CSV-gated.
  w.pushNumber(p.decision_timeout_blocks);
  w.op(OP.OP_CHECKSEQUENCEVERIFY);
  w.op(OP.OP_DROP);
  w.op(OP.OP_IF);
  // Cooperative fallback: m-of-(n-1) of other players.
  if (p.other_pubkeys.length === 0) {
    // Degenerate: no other pubkeys means cooperative fallback impossible.
    // Place a known-false predicate so the branch always fails.
    w.op(OP.OP_RETURN);
  } else {
    if (p.other_pubkeys.length > 16) {
      throw new Error('buildEntropyCommitScript: other_pubkeys > 16 not supported in v1');
    }
    w.pushNumber(p.other_pubkeys.length);
    for (const pk of p.other_pubkeys) w.pushPubkey(pk);
    w.pushNumber(p.other_pubkeys.length);
    w.op(OP.OP_CHECKMULTISIG);
  }
  w.op(OP.OP_ELSE);
  // CLTV recovery refund.
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);
  w.op(OP.OP_ENDIF);
  return w.bytes();
}
