/**
 * RuleSet — the complete agreed rules for a session.
 *
 * Per `spec/state-machine.md`, every transaction in a session binds to
 * the `rule_set_hash` derived by canonical-encoding the RuleSet and
 * applying domain-separated SHA-256 (`spec/serialisation.md` §5).
 */

import type { Satoshis } from './primitives.js';

/**
 * Game type identifier. v1 supports `in_between` only; future game types
 * appear as additional members.
 */
export type GameType = 'in_between';

/**
 * Schedule of penalties applied for protocol-level misbehaviour at
 * settlement or recovery time.
 */
export interface PenaltySchedule {
  /** Amount deducted from a non-revealer at S4 ENTROPY_REVEAL or showdown. */
  readonly non_reveal: Satoshis;
  /** Amount deducted when a reveal preimage fails cryptographic verification. */
  readonly bad_reveal: Satoshis;
  /** Fixed penalty paid into the pot when visible cards are consecutive (In-Between). */
  readonly consecutive_cards: Satoshis;
  /** Fixed penalty paid into the pot when visible cards are equal (In-Between). */
  readonly equal_cards: Satoshis;
}

/**
 * Settlement rules for resolving a round outcome class to a value transfer.
 * Multipliers operate on the bet amount; penalties are fixed satoshi
 * amounts.
 */
export interface SettlementRules {
  /** Multiplier on the bet for a winning round. v1 default = 1 (player wins back bet × 1). */
  readonly in_between_win_multiplier: number;
  /** Multiplier on the bet for a losing round. v1 default = 1 (player loses the bet × 1). */
  readonly in_between_loss_multiplier: number;
  /** Fixed penalty paid into pot on consecutive-cards rule trigger. */
  readonly consecutive_cards_penalty: Satoshis;
  /** Fixed penalty paid into pot on equal-cards rule trigger. */
  readonly equal_cards_penalty: Satoshis;
}

/**
 * Recovery rules applied when a session enters RECOVERED state. These
 * direct the distribution of stranded value.
 */
export interface RecoveryRules {
  /** If true, every player stake is refunded to its original funder. */
  readonly refund_stakes_to_funders: boolean;
  /** If true, the `non_reveal` penalty in PenaltySchedule applies during recovery. */
  readonly apply_non_reveal_penalty: boolean;
  /** If true, the `bad_reveal` penalty applies during recovery. */
  readonly apply_bad_reveal_penalty: boolean;
}

/**
 * The canonical rule set for one session. Every field is required (no
 * implicit defaults) — the rule set is hashed into the binding of every
 * subsequent transaction, so silent defaults would be a binding hazard.
 */
export interface RuleSet {
  readonly game_type: GameType;
  readonly player_count_min: number;
  readonly player_count_max: number;
  readonly stake_amount: Satoshis;
  readonly min_bet: Satoshis;
  readonly max_bet: Satoshis;
  readonly decision_timeout_blocks: number;
  readonly recovery_timeout_blocks: number;
  readonly invitation_window_blocks: number;
  /**
   * Map from state-class identifier (e.g. `S8_BET_DECISION`) to the
   * default action applied on decision-timeout silence at that state.
   */
  readonly default_action_by_state: Readonly<Record<string, string>>;
  readonly penalty_schedule: PenaltySchedule;
  /** 52 or 54 cards. */
  readonly deck_format: 52 | 54;
  /** Identifier of the shuffle algorithm; v1 = 1 (Fisher-Yates over Keccak stream). */
  readonly shuffle_algorithm_version: number;
  readonly settlement_rules: SettlementRules;
  readonly recovery_rules: RecoveryRules;
  /** Serialisation schema version. v1 = 1. */
  readonly serialisation_version: number;
}
