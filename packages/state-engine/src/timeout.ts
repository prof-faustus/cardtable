/**
 * Timeout eligibility computation.
 *
 * Per `spec/timeout-rules.md`. Pure functions over (state, block height).
 */

import type { BlockHeight, RoundState } from '@cardtable/protocol-types';

/**
 * For a given state and a current block height, return which branches
 * (cooperative, timeout, recovery) are currently spendable.
 */
export function eligibility(
  state: RoundState,
  currentHeight: BlockHeight,
): { canCooperate: boolean; canTimeout: boolean; canRecover: boolean } {
  const canCooperate = state.allowed_actions.length > 0;
  const canTimeout =
    state.decision_deadline_block_height !== null &&
    currentHeight >= state.decision_deadline_block_height;
  const canRecover =
    state.recovery_deadline_block_height !== null &&
    currentHeight >= state.recovery_deadline_block_height;
  return { canCooperate, canTimeout, canRecover };
}

/**
 * Validate that `decision_timeout_blocks < recovery_timeout_blocks` for
 * a rule set's two-deadline interaction (per spec/timeout-rules.md §3).
 */
export function validateTimeoutOrdering(
  decisionBlocks: number,
  recoveryBlocks: number,
): boolean {
  return Number.isFinite(decisionBlocks)
    && Number.isFinite(recoveryBlocks)
    && decisionBlocks < recoveryBlocks
    && decisionBlocks > 0
    && recoveryBlocks > 0;
}
