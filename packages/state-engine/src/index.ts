/**
 * Public API of @cardtable/state-engine.
 *
 * Pure deterministic functions only. No I/O, no clock, no shared state.
 */

export {
  initialState,
  applyAction,
  getLegalActions,
  computeSettlement,
} from './engine.js';

export { eligibility, validateTimeoutOrdering } from './timeout.js';

export {
  classifyInBetweenRound,
  computeValueTransfer,
} from './penalties.js';

export { addToPot, subtractFromPot } from './pot.js';

export { pickConflictWinner } from './ordering.js';
export type { CandidateSnapshot } from './ordering.js';

export { replay, replayWithVerification, chainsFrom } from './replay.js';

export { verifyAndApply } from './verify.js';

export { enumerateFallbackGraph } from './fallback.js';
export type { FallbackBranch, FallbackKind, LockTimeSpec } from './fallback.js';

export { materialiseFallbackGraph } from './fallback-build.js';
export type { BuildContext, BuiltFallbackBranch } from './fallback-build.js';

export { buildCooperativeTx, buildTimeoutTx, buildRecoveryTx } from './tx-orchestrator.js';
export type { PrevOutpoint, SuccessorOutput } from './tx-orchestrator.js';
