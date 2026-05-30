/**
 * RoundState and GameInstance types.
 *
 * Per `spec/state-machine.md` §5 (the canonical state-class set) and the
 * `RoundState` / `GameInstance` shapes used by the test vectors.
 */

import type {
  BlockHeight,
  GameId,
  Hash256,
  RoundNumber,
  RuleSetHash,
  Satoshis,
  Seat,
} from './primitives.js';
import type { ActionType } from './actions.js';
import type { RevealedCard } from './cards.js';
import type { PlayerState } from './player.js';

/** State classes per `spec/state-machine.md` §3. */
export type StateClass =
  | 'S0_TABLE_OPEN'
  | 'S1_SEAT_OPEN'
  | 'S2_TABLE_LOCKED'
  | 'S3_ENTROPY_COMMIT_WINDOW'
  | 'S4_ENTROPY_REVEAL_WINDOW'
  | 'S5_DECK_COMMITTED'
  | 'S6_CARD_REVEAL_FIRST'
  | 'S7_CARD_REVEAL_SECOND'
  | 'S8_BET_DECISION'
  | 'S9_CARD_REVEAL_THIRD'
  | 'S10_SETTLED_ROUND'
  | 'S11_ROTATE_TURN'
  | 'S12_TABLE_CLOSE'
  | 'RECOVERED';

/** Lifecycle status of a {@link GameInstance}. */
export type LifecycleStatus =
  | 'open'
  | 'locked'
  | 'shuffling'
  | 'dealing'
  | 'active'
  | 'settling'
  | 'closed'
  | 'recovered';

/**
 * The canonical state object committed at every node of the protocol's
 * transaction tree. Two honest implementations MUST compute byte-identical
 * encodings of this record for the same logical input.
 */
export interface RoundState {
  readonly state_class: StateClass;
  readonly game_id: GameId;
  readonly rule_set_hash: RuleSetHash;
  readonly round_number: RoundNumber;
  /** Acting player's seat; null for quorum-driven or deterministic states. */
  readonly acting_player_seat: Seat | null;
  readonly players: readonly PlayerState[];
  readonly pot_value: Satoshis;
  readonly visible_cards: readonly RevealedCard[];
  /** References (commitment hashes) to deck positions not yet opened. */
  readonly hidden_commitment_refs: readonly Hash256[];
  /** Actions legal from this state. */
  readonly allowed_actions: readonly ActionType[];
  /** Block height after which the timeout branch becomes spendable; null = no timeout. */
  readonly decision_deadline_block_height: BlockHeight | null;
  /** Absolute block height after which the recovery branch becomes spendable. */
  readonly recovery_deadline_block_height: BlockHeight | null;
  /** Set of canonical-template hashes that name the legal successors. */
  readonly successor_template_hashes: readonly Hash256[];
  /** Hash of the parent state in the transition tree; null at the root. */
  readonly prior_state_hash: Hash256 | null;
  /**
   * State hash computed by domain-separated SHA-256 over the canonical
   * encoding of this record with this field set to 64 zero chars.
   */
  readonly state_hash: Hash256;
}

/**
 * Top-level session object. Cross-state aggregate; useful for indexers
 * and the client lobby, but the state engine itself operates on
 * {@link RoundState}.
 */
export interface GameInstance {
  readonly game_id: GameId;
  readonly rule_set_hash: RuleSetHash;
  /** Stable ordering: players in canonical seat order. */
  readonly player_list: readonly PlayerState[];
  /** Turn order (seat permutation); turn_order[i] is the seat of the i-th turn. */
  readonly turn_order: readonly Seat[];
  readonly current_round_number: RoundNumber;
  readonly current_state_hash: Hash256;
  readonly lifecycle_status: LifecycleStatus;
}
