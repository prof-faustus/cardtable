/**
 * Recovery script — not a new template per `spec/script-templates.md` §2.9:
 * Recovery is a multi-input transaction whose inputs satisfy the
 * recovery branches of the existing templates (`stake-lock`, `pot-lock`,
 * `entropy-commit`, `card-custody`, `round-state`).
 *
 * This module provides a helper to build the canonical CLTV-+-pubkey
 * branch that those templates share — useful for the pre-signed
 * recovery-graph builder.
 */

import type { BlockHeight, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface RecoveryBranchParams {
  readonly recovery_height: BlockHeight;
  readonly signer_pubkey: Pubkey33;
}

/**
 * Build the canonical CLTV-gated single-sig recovery body. This is the
 * inner body of the recovery branch shared by every template that has
 * an "original funder gets their value back after time" exit.
 */
export function buildRecoveryBranch(p: RecoveryBranchParams): Uint8Array {
  const w = new ScriptWriter();
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.signer_pubkey);
  w.op(OP.OP_CHECKSIG);
  return w.bytes();
}
