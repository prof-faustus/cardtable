/**
 * Pre-signed fallback graph enumeration.
 *
 * At session start every state must already have its three branches
 * named: the cooperative successor (happy path), the timeout-default
 * (fires at decision_deadline_block_height), and the global recovery
 * (fires at recovery_deadline_block_height). This module is the
 * deterministic enumeration of those branches for a given state.
 *
 * The companion BSV-transaction construction lives in
 * `packages/script-templates`; this module is the protocol-level
 * description of which branches exist, not the wire-level signing.
 */

import type { ActionType, BlockHeight, RoundState, RuleSet, StateClass } from '@cardtable/protocol-types';

/**
 * One branch in the pre-signed fallback graph. Three branches per
 * state in the v1 protocol:
 *
 *   - cooperative: signed by the acting player (or the relevant
 *     quorum). Spendable immediately.
 *   - timeout:     signed by the non-acting majority. Spendable once
 *     the input's relative-locktime delta has elapsed since the prior
 *     state's confirmation — modelled here as relative_blocks.
 *   - recovery:    signed by every seated player. Spendable once
 *     nLockTime reaches recovery_deadline_block_height.
 */
export type FallbackKind = 'cooperative' | 'timeout' | 'recovery';

export interface FallbackBranch {
  readonly kind: FallbackKind;
  readonly source_state_class: StateClass;
  readonly action_type: ActionType;
  readonly lock_time_spec: LockTimeSpec;
  /** Free-form description for documentation / debugging. */
  readonly note: string;
}

export type LockTimeSpec =
  | { readonly kind: 'immediate' }
  | { readonly kind: 'relative_blocks'; readonly blocks: number }
  | { readonly kind: 'absolute_height'; readonly height: BlockHeight };

/**
 * Enumerate the fallback branches that must be pre-signed for the
 * given state. The result is the same for every honest engine
 * (it depends only on state_class, the rule set, and the state's
 * deadline annotations).
 */
export function enumerateFallbackGraph(state: RoundState, ruleSet: RuleSet): readonly FallbackBranch[] {
  const branches: FallbackBranch[] = [];
  const cooperativeAction = cooperativeFor(state.state_class);
  if (cooperativeAction !== null) {
    branches.push({
      kind: 'cooperative',
      source_state_class: state.state_class,
      action_type: cooperativeAction,
      lock_time_spec: { kind: 'immediate' },
      note: 'happy path; signed at session start by the acting player or relevant quorum',
    });
  }
  const timeoutAction = timeoutDefaultFor(state.state_class);
  if (timeoutAction !== null) {
    branches.push({
      kind: 'timeout',
      source_state_class: state.state_class,
      action_type: timeoutAction,
      lock_time_spec: { kind: 'relative_blocks', blocks: ruleSet.decision_timeout_blocks },
      note: `timeout default after decision_timeout_blocks=${ruleSet.decision_timeout_blocks} blocks`,
    });
  }
  if (state.recovery_deadline_block_height !== null) {
    branches.push({
      kind: 'recovery',
      source_state_class: state.state_class,
      action_type: 'Recovery',
      lock_time_spec: { kind: 'absolute_height', height: state.recovery_deadline_block_height },
      note: 'global recovery; signed by every seated player at session start',
    });
  }
  return branches;
}

/** The single cooperative action class for a given state, or null. */
function cooperativeFor(sc: StateClass): ActionType | null {
  switch (sc) {
    case 'S1_SEAT_OPEN':
      return 'Join'; // also TableLock, modelled as a separate branch via the engine.
    case 'S2_TABLE_LOCKED':
    case 'S3_ENTROPY_COMMIT_WINDOW':
      return 'EntropyCommit';
    case 'S4_ENTROPY_REVEAL_WINDOW':
      return 'EntropyReveal';
    case 'S5_DECK_COMMITTED':
    case 'S6_CARD_REVEAL_FIRST':
    case 'S9_CARD_REVEAL_THIRD':
      return 'CardReveal';
    case 'S7_CARD_REVEAL_SECOND':
    case 'S8_BET_DECISION':
      return 'BetAction';
    case 'S10_SETTLED_ROUND':
      return 'Settle';
    case 'S11_ROTATE_TURN':
      return 'RotateTurn';
    case 'S12_TABLE_CLOSE':
      return 'TableClose';
    default:
      return null;
  }
}

/** The default-consequence timeout for a given state, or null. */
function timeoutDefaultFor(sc: StateClass): ActionType | null {
  switch (sc) {
    case 'S3_ENTROPY_COMMIT_WINDOW':
    case 'S4_ENTROPY_REVEAL_WINDOW':
      return 'Timeout'; // non-revealer is penalised; remaining quorum advances
    case 'S7_CARD_REVEAL_SECOND':
    case 'S8_BET_DECISION':
    case 'S9_CARD_REVEAL_THIRD':
      return 'Timeout';
    default:
      return null;
  }
}
