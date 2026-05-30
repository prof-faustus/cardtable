/**
 * Standalone timeout-branch builder.
 *
 * Used in tests and by the pre-signed fallback graph builder. The
 * locking script is preimage + n-of-n multisig; the spending tx's
 * input `nSequence` carries the relative-locktime delta so miners
 * reject it before the decision deadline matures. **No in-script
 * timelock opcode.**
 */

import type { Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { relativeBlocks } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface TimeoutBranchParams {
  /** Relative-locktime delta encoded onto the spending input's nSequence. */
  readonly decision_timeout_blocks: number;
  /** Domain-separated commitment to the timeout-template body. */
  readonly timeout_template_hash: Hash256;
  /** Authorisers whose n-of-n multisig signs the pre-built timeout tx. */
  readonly authoriser_pubkeys: readonly Pubkey33[];
}

export interface BuiltTimeoutBranch {
  readonly locking_script: Uint8Array;
  readonly locktime: LockTimeSpec;
}

export function buildTimeoutBranch(p: TimeoutBranchParams): BuiltTimeoutBranch {
  if (p.authoriser_pubkeys.length === 0) {
    throw new Error('buildTimeoutBranch: at least one authoriser required');
  }
  if (p.authoriser_pubkeys.length > 16) {
    throw new Error('buildTimeoutBranch: authoriser count > 16 not supported in v1');
  }
  const w = new ScriptWriter();
  w.op(OP.OP_HASH256);
  w.pushHash32(p.timeout_template_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushNumber(p.authoriser_pubkeys.length);
  for (const pk of p.authoriser_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.authoriser_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  return {
    locking_script: w.bytes(),
    locktime: relativeBlocks(p.decision_timeout_blocks),
  };
}

export function buildTimeoutBranchScript(p: TimeoutBranchParams): Uint8Array {
  return buildTimeoutBranch(p).locking_script;
}
