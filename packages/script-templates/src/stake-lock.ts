/**
 * `stake-lock` template.
 *
 * Three exits — cooperative settle, winner claim, refund — all
 * authorised by an IF/ELSE branch over signature/preimage checks.
 * **No in-script timelock opcode.** The refund branch's timing is
 * gated by the spending transaction's `nLockTime`; the script merely
 * authorises the player's signature on that pre-signed refund tx.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight, immediate } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface StakeLockParams {
  readonly player_pubkey: Pubkey33;
  readonly operator_pubkey: Pubkey33;
  /** Domain-separated commitment to the expected settlement preimage. */
  readonly expected_settlement_hash: Hash256;
  /** Absolute block height at which the pre-signed refund tx becomes valid. */
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltStakeLock {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

/**
 * Build the locking script and the table of pre-signed branches. The
 * locking script has three IF/ELSE sub-branches:
 *   1. Cooperative: 2-of-2 player + operator.
 *   2. Winner claim: HASH256 preimage + player signature.
 *   3. Refund: player signature only — the refund transaction's
 *      `nLockTime` (set to `recovery_height`) gates when miners
 *      accept it.
 */
export function buildStakeLock(p: StakeLockParams): BuiltStakeLock {
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // 1. Cooperative settle: 2-of-2 player + operator.
  w.pushNumber(2);
  w.pushPubkey(p.player_pubkey);
  w.pushPubkey(p.operator_pubkey);
  w.pushNumber(2);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  // 2. Winner claim: settlement preimage + player sig.
  w.op(OP.OP_HASH256);
  w.pushHash32(p.expected_settlement_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  // 3. Refund: player signature on a tx whose nLockTime is
  // recovery_height. Authorisation is just CHECKSIG; the timing is
  // enforced by the spending transaction's locktime field.
  w.pushPubkey(p.player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);

  w.op(OP.OP_ENDIF);
  return {
    locking_script: w.bytes(),
    branches: [
      { name: 'cooperative', locktime: immediate },
      { name: 'winner_claim', locktime: immediate },
      { name: 'refund', locktime: absoluteHeight(p.recovery_height) },
    ],
  };
}

/** Locking-script-only convenience. */
export function buildStakeLockScript(p: StakeLockParams): Uint8Array {
  return buildStakeLock(p).locking_script;
}
