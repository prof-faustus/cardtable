/**
 * Deterministic replay from a transcript.
 */

import type {
  BlockHeight,
  GameId,
  Hash256,
  ProtocolError,
  Result,
  RoundState,
  RuleSet,
  RuleSetHash,
  SignedAction,
} from '@cardtable/protocol-types';
import { err, ok, protocolError } from '@cardtable/protocol-types';
import { applyAction, initialState } from './engine.js';

/**
 * Replay a sequence of signed actions against a fresh initial state.
 * Returns the resulting state on success or the first error encountered.
 *
 * Actions are applied in the order they appear in `actions`; the caller
 * is responsible for canonical ordering (per `spec/ordering-rules.md`)
 * if the actions came from an unordered set.
 *
 * @param game_id           Session identifier.
 * @param rule_set_hash     Hash of the agreed rule set.
 * @param rule_set          The rule set itself (must hash to `rule_set_hash`).
 * @param recovery_deadline Absolute block height for the global recovery branch.
 * @param actions           Signed actions in canonical order.
 * @param block_heights     Per-action block-height annotation; the i-th action
 *                          is evaluated at block height `block_heights[i]`. If
 *                          the array is shorter than `actions`, the last
 *                          height is reused for the remaining actions.
 */
export function replay(args: {
  readonly game_id: GameId;
  readonly rule_set_hash: RuleSetHash;
  readonly rule_set: RuleSet;
  readonly recovery_deadline: BlockHeight;
  readonly actions: readonly SignedAction[];
  readonly block_heights: readonly BlockHeight[];
}): Result<RoundState, ProtocolError> {
  let state = initialState(args.game_id, args.rule_set_hash, args.recovery_deadline);
  for (let i = 0; i < args.actions.length; i++) {
    const action = args.actions[i];
    if (action === undefined) {
      return err(protocolError('SERIALISATION_ERROR', `replay: action ${i} is undefined`));
    }
    const heightCandidate = args.block_heights[i] ?? args.block_heights[args.block_heights.length - 1];
    if (heightCandidate === undefined) {
      return err(protocolError('SERIALISATION_ERROR', `replay: no block height for action ${i}`));
    }
    const result = applyAction(state, action, args.rule_set, heightCandidate);
    if (!result.ok) {
      return err(protocolError(
        result.error.code,
        `replay: action ${i} (${action.action_type}) rejected: ${result.error.context ?? ''}`,
      ));
    }
    state = result.value;
  }
  return ok(state);
}

/**
 * Sanity check that a state's `prior_state_hash` correctly chains. Pure
 * structural check — does not recompute the hash from the canonical
 * encoding (that requires a hash provider; live in protocol-types).
 */
export function chainsFrom(
  prior: RoundState | null,
  next: RoundState,
): boolean {
  if (prior === null) return next.prior_state_hash === null;
  // We accept either the prior's state_hash matching next.prior_state_hash,
  // OR (for the initial zero-hash) a null prior chain.
  return next.prior_state_hash === prior.state_hash;
}

// re-export Hash256 type for callers that need it indirectly
export type { Hash256 };
