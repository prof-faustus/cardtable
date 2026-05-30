/**
 * Public API of @cardtable/script-templates.
 *
 * Every locking-script builder is a pure function returning the
 * canonical BSV script bytes plus the table of pre-signed branches the
 * downstream transaction builder will use. Timing constraints on
 * branches are conveyed in the per-branch `LockTimeSpec` and applied
 * by the tx builder via the spending transaction's `nLockTime` /
 * `nSequence` fields. **No in-script timelock opcode is used by any
 * template.**
 *
 * Witness construction (unlocking scripts) is left to the downstream
 * BSV SDK, which knows the signing key material and sighash flags.
 */

export { OP, opNumber } from './opcodes.js';
export type { Opcode } from './opcodes.js';

export { ScriptWriter, encodeScriptNum, bytesToHex } from './writer.js';

export {
  immediate,
  absoluteHeight,
  relativeBlocks,
} from './locktime.js';
export type { LockTimeSpec } from './locktime.js';

export {
  buildTableRoot,
  buildTableRootLockingScript,
} from './table-root.js';
export type { TableRootParams } from './table-root.js';

export {
  buildStakeLock,
  buildStakeLockScript,
} from './stake-lock.js';
export type { StakeLockParams } from './stake-lock.js';

export {
  buildPotLock,
  buildPotLockScript,
} from './pot-lock.js';
export type { PotLockParams } from './pot-lock.js';

export {
  buildEntropyCommit,
  buildEntropyCommitScript,
} from './entropy-commit.js';
export type { EntropyCommitParams } from './entropy-commit.js';

export {
  buildCardCustody,
  buildCardCustodyScript,
} from './card-custody.js';
export type { CardCustodyParams } from './card-custody.js';

export {
  buildRoundState,
  buildRoundStateScript,
} from './round-state.js';
export type { RoundStateParams } from './round-state.js';

export { buildSettleClaimScript } from './settle-claim.js';
export type { SettleClaimParams } from './settle-claim.js';

export {
  buildFoldSurrender,
  buildFoldSurrenderScript,
} from './fold-surrender.js';
export type { FoldSurrenderParams } from './fold-surrender.js';

export { buildRevealProofScript } from './reveal-proof.js';
export type { RevealProofParams } from './reveal-proof.js';

export {
  buildTimeoutBranch,
  buildTimeoutBranchScript,
} from './timeout-branch.js';
export type { TimeoutBranchParams } from './timeout-branch.js';

export {
  buildRecoveryBranch,
  buildRecoveryBranchTemplate,
} from './recovery.js';
export type { RecoveryBranchParams } from './recovery.js';
