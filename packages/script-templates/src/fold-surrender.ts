/**
 * `fold-surrender` template — output produced by a fold (Phase 4+
 * extended model only).
 *
 * The surrendered output's only exit is the recovery refund to the
 * original funder. Timing is enforced at the spending transaction
 * level: the pre-signed recovery tx carries `nLockTime =
 * recovery_height`. The script itself is a bare CHECKSIG; it does NOT
 * carry an in-script timelock opcode and does NOT require the card
 * face to be revealed.
 */

import type { BlockHeight, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';
import { absoluteHeight } from './locktime.js';
import type { LockTimeSpec } from './locktime.js';

export interface FoldSurrenderParams {
  readonly original_funder_pubkey: Pubkey33;
  readonly recovery_height: BlockHeight;
}

export interface BranchSpec {
  readonly name: string;
  readonly locktime: LockTimeSpec;
}

export interface BuiltFoldSurrender {
  readonly locking_script: Uint8Array;
  readonly branches: readonly BranchSpec[];
}

export function buildFoldSurrender(p: FoldSurrenderParams): BuiltFoldSurrender {
  const w = new ScriptWriter();
  w.pushPubkey(p.original_funder_pubkey);
  w.op(OP.OP_CHECKSIG);
  return {
    locking_script: w.bytes(),
    branches: [
      { name: 'recovery_refund', locktime: absoluteHeight(p.recovery_height) },
    ],
  };
}

export function buildFoldSurrenderScript(p: FoldSurrenderParams): Uint8Array {
  return buildFoldSurrender(p).locking_script;
}
