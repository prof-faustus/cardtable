/**
 * `table-root` template.
 *
 * Locks the table-root output under an n-of-n multisig of the seated
 * participants. Every legal spend (TableLock, cooperative close,
 * refund, recovery) is one of a set of **pre-signed** transactions,
 * each carrying its own `nLockTime` / input `nSequence` to gate
 * timing at the transaction level. The script itself has no in-script
 * timelock opcode.
 */

import type { BlockHeight, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight, immediate } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface TableRootParams {
  /** All seated player pubkeys (or invited pubkeys for the open variant). */
  readonly seated_pubkeys: readonly Pubkey33[];
  /** Absolute block height at which the recovery branch's pre-signed tx becomes valid. */
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltTemplate {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

/**
 * Build the locking script bytes and the branch table that names the
 * pre-signed spending transactions. The script is a single n-of-n
 * CHECKMULTISIG; each branch corresponds to a distinct pre-signed
 * transaction whose `nLockTime` gates when miners will accept it.
 */
export function buildTableRoot(p: TableRootParams): BuiltTemplate {
  if (p.seated_pubkeys.length === 0) {
    throw new Error('buildTableRoot: at least one pubkey required');
  }
  if (p.seated_pubkeys.length > 16) {
    throw new Error(
      `buildTableRoot: seat count ${p.seated_pubkeys.length} exceeds v1 max of 16`,
    );
  }
  const w = new ScriptWriter();
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  return {
    locking_script: w.bytes(),
    branches: [
      { name: 'cooperative', locktime: immediate },
      { name: 'recovery', locktime: absoluteHeight(p.recovery_height) },
    ],
  };
}

/** Locking-script-only convenience. */
export function buildTableRootLockingScript(p: TableRootParams): Uint8Array {
  return buildTableRoot(p).locking_script;
}
