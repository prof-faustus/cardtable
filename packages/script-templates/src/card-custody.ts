/**
 * `card-custody` template (extended one-UTXO-per-card model only).
 *
 * Three exits:
 *   1. Reveal — face preimage + holder signature.
 *   2. Fold surrender — holder signature on the pre-signed fold tx.
 *   3. Recovery refund — original-funder signature on the pre-signed
 *      refund tx whose `nLockTime` is `recovery_height`.
 *
 * **No in-script timelock opcode.**
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight, immediate } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface CardCustodyParams {
  readonly face_commitment: Hash256;
  readonly holder_pubkey: Pubkey33;
  readonly original_funder_pubkey: Pubkey33;
  /** Absolute block height at which the pre-signed recovery refund tx becomes valid. */
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltCardCustody {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

export function buildCardCustody(p: CardCustodyParams): BuiltCardCustody {
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  w.op(OP.OP_HASH256);
  w.pushHash32(p.face_commitment);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.holder_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  w.op(OP.OP_IF);
  // Fold surrender — bare holder sig, no preimage. Encryption preserved.
  w.pushPubkey(p.holder_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);
  // Recovery refund — bare funder sig. nLockTime on the refund tx is
  // recovery_height; the script does not encode the timing.
  w.pushPubkey(p.original_funder_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);
  w.op(OP.OP_ENDIF);
  return {
    locking_script: w.bytes(),
    branches: [
      { name: 'reveal', locktime: immediate },
      { name: 'fold_surrender', locktime: immediate },
      { name: 'recovery_refund', locktime: absoluteHeight(p.recovery_height) },
    ],
  };
}

export function buildCardCustodyScript(p: CardCustodyParams): Uint8Array {
  return buildCardCustody(p).locking_script;
}
