/**
 * `round-state` template.
 *
 * Three branches via IF/ELSE:
 *   1. Action — successor template preimage + acting player signature.
 *   2. Timeout — pre-signed timeout-default tx, n-of-n authorisation,
 *      bound to a timeout template preimage.
 *   3. Recovery — pre-signed recovery tx, n-of-n authorisation.
 *
 * Timing on branches 2 and 3 is enforced at the spending **transaction
 * level**: the timeout tx's input `nSequence` carries
 * `decision_timeout_blocks` as a relative-locktime delta; the
 * recovery tx's `nLockTime` is `recovery_height`. **No in-script
 * timelock opcode.**
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight, immediate, relativeBlocks } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface RoundStateParams {
  readonly successor_template_hash: Hash256;
  readonly timeout_template_hash: Hash256;
  readonly acting_player_pubkey: Pubkey33;
  readonly seated_pubkeys: readonly Pubkey33[];
  readonly decision_timeout_blocks: number;
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltRoundState {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

export function buildRoundState(p: RoundStateParams): BuiltRoundState {
  if (p.seated_pubkeys.length === 0) {
    throw new Error('buildRoundState: at least one seated pubkey required');
  }
  if (p.seated_pubkeys.length > 16) {
    throw new Error('buildRoundState: seat count > 16 not supported in v1');
  }
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Action branch.
  w.op(OP.OP_HASH256);
  w.pushHash32(p.successor_template_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushPubkey(p.acting_player_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ELSE);

  w.op(OP.OP_IF);
  // Timeout branch — preimage + multisig.
  w.op(OP.OP_HASH256);
  w.pushHash32(p.timeout_template_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);
  // Recovery branch — multisig only.
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ENDIF);

  w.op(OP.OP_ENDIF);
  return {
    locking_script: w.bytes(),
    branches: [
      { name: 'action', locktime: immediate },
      { name: 'timeout', locktime: relativeBlocks(p.decision_timeout_blocks) },
      { name: 'recovery', locktime: absoluteHeight(p.recovery_height) },
    ],
  };
}

export function buildRoundStateScript(p: RoundStateParams): Uint8Array {
  return buildRoundState(p).locking_script;
}
