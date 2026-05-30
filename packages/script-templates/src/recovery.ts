/**
 * Recovery branch helper.
 *
 * Recovery is not a new template; it is a multi-input transaction
 * whose inputs satisfy the recovery branches of the existing
 * templates. The canonical recovery-branch body is a bare signature
 * check — timing is enforced by the spending tx's `nLockTime =
 * recovery_height`. **No in-script timelock opcode.**
 */

import type { BlockHeight, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface RecoveryBranchParams {
  readonly recovery_height: BlockHeight;
  readonly signer_pubkey: Pubkey33;
}

export interface BuiltRecoveryBranch {
  readonly locking_script: Uint8Array;
  readonly locktime: LockTimeSpec;
}

export function buildRecoveryBranchTemplate(p: RecoveryBranchParams): BuiltRecoveryBranch {
  const w = new ScriptWriter();
  w.pushPubkey(p.signer_pubkey);
  w.op(OP.OP_CHECKSIG);
  return {
    locking_script: w.bytes(),
    locktime: absoluteHeight(p.recovery_height),
  };
}

export function buildRecoveryBranch(p: RecoveryBranchParams): Uint8Array {
  return buildRecoveryBranchTemplate(p).locking_script;
}
