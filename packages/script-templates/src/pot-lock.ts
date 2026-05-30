/**
 * `pot-lock` template.
 *
 * Three exits: cooperative n-of-n settle, winner claim with proof,
 * refund. The refund branch's timing is gated by the spending
 * transaction's `nLockTime`; the script just authorises the refund
 * signer.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight, immediate } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface PotLockParams {
  readonly seated_pubkeys: readonly Pubkey33[];
  readonly winner_proof_hash: Hash256;
  readonly winner_pubkey: Pubkey33;
  readonly refund_pubkey: Pubkey33;
  /** Absolute block height at which the pre-signed refund tx becomes valid. */
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltPotLock {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

export function buildPotLock(p: PotLockParams): BuiltPotLock {
  if (p.seated_pubkeys.length === 0) {
    throw new Error('buildPotLock: at least one pubkey required');
  }
  if (p.seated_pubkeys.length > 16) {
    throw new Error('buildPotLock: seat count > 16 not supported in v1');
  }
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Cooperative n-of-n.
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  // Winner claim: SHA-256 preimage + winner sig.
  w.op(OP.OP_SHA256);
  w.pushHash32(p.winner_proof_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.winner_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  // Refund: bare signature; pre-signed tx has nLockTime = recovery_height.
  w.pushPubkey(p.refund_pubkey);
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

export function buildPotLockScript(p: PotLockParams): Uint8Array {
  return buildPotLock(p).locking_script;
}
