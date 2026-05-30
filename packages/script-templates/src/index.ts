/**
 * Public API of @cardtable/script-templates.
 *
 * Every locking-script builder is a pure function:
 *   (params) -> Uint8Array (canonical BSV script bytes).
 *
 * Witness construction (unlocking scripts) is left to the downstream BSV
 * SDK, which knows the signing key material and sighash flags. The
 * template builders here only produce locking-script bodies.
 */

export { OP, opNumber } from './opcodes.js';
export type { Opcode } from './opcodes.js';

export { ScriptWriter, encodeScriptNum, bytesToHex } from './writer.js';

export { buildTableRootLockingScript } from './table-root.js';
export type { TableRootParams } from './table-root.js';

export { buildStakeLockScript } from './stake-lock.js';
export type { StakeLockParams } from './stake-lock.js';

export { buildPotLockScript } from './pot-lock.js';
export type { PotLockParams } from './pot-lock.js';

export { buildEntropyCommitScript } from './entropy-commit.js';
export type { EntropyCommitParams } from './entropy-commit.js';

export { buildCardCustodyScript } from './card-custody.js';
export type { CardCustodyParams } from './card-custody.js';

export { buildRoundStateScript } from './round-state.js';
export type { RoundStateParams } from './round-state.js';

export { buildSettleClaimScript } from './settle-claim.js';
export type { SettleClaimParams } from './settle-claim.js';

export { buildFoldSurrenderScript } from './fold-surrender.js';
export type { FoldSurrenderParams } from './fold-surrender.js';

export { buildRevealProofScript } from './reveal-proof.js';
export type { RevealProofParams } from './reveal-proof.js';

export { buildTimeoutBranchScript } from './timeout-branch.js';
export type { TimeoutBranchParams } from './timeout-branch.js';

export { buildRecoveryBranch } from './recovery.js';
export type { RecoveryBranchParams } from './recovery.js';
