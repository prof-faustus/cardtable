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

export { replay, chainsFrom } from './replay.js';
