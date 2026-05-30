/**
 * `entropy-commit` template.
 *
 * One UTXO per player carrying that player's entropy commitment.
 * Three exits via IF/ELSE branches:
 *   1. Reveal — player provides entropy preimage + signature.
 *   2. Cooperative fallback — every counterparty (n-of-(n-1)) signs
 *      a pre-signed advance-without-this-player tx; that tx's input
 *      `nSequence` carries the relative-locktime delta so miners
 *      reject it before the decision deadline matures.
 *   3. Refund — bare player signature on a pre-signed refund tx
 *      whose `nLockTime` equals the recovery height.
 *
 * **No in-script timelock opcode.**
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight, immediate, relativeBlocks } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface EntropyCommitParams {
  readonly commitment_hash: Hash256;
  readonly player_pubkey: Pubkey33;
  readonly other_pubkeys: readonly Pubkey33[];
  readonly decision_timeout_blocks: number;
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltEntropyCommit {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

export function buildEntropyCommit(p: EntropyCommitParams): BuiltEntropyCommit {
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // 1. Reveal branch.
  w.op(OP.OP_SHA256);
  w.pushHash32(p.commitment_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  // 2. Cooperative fallback: n-of-(n-1) of the other players sign the
  // pre-signed advance-without-this-player tx. With no counterparties
  // the branch is unsatisfiable — OP_RETURN poisons it.
  if (p.other_pubkeys.length === 0) {
    w.op(OP.OP_RETURN);
  } else {
    if (p.other_pubkeys.length > 16) {
      throw new Error('buildEntropyCommit: other_pubkeys > 16 not supported in v1');
    }
    w.pushNumber(p.other_pubkeys.length);
    for (const pk of p.other_pubkeys) w.pushPubkey(pk);
    w.pushNumber(p.other_pubkeys.length);
    w.op(OP.OP_CHECKMULTISIG);
  }
  w.op(OP.OP_ELSE);
  // 3. Refund: bare player signature on a tx whose nLockTime is the
  // recovery height. Timing enforced by the spending tx, not script.
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);

  w.op(OP.OP_ENDIF);
  return {
    locking_script: w.bytes(),
    branches: [
      { name: 'reveal', locktime: immediate },
      { name: 'cooperative_fallback', locktime: relativeBlocks(p.decision_timeout_blocks) },
      { name: 'refund', locktime: absoluteHeight(p.recovery_height) },
    ],
  };
}

export function buildEntropyCommitScript(p: EntropyCommitParams): Uint8Array {
  return buildEntropyCommit(p).locking_script;
}
