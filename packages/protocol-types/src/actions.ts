/**
 * Action types — what a player can do at each state.
 *
 * Per `spec/state-machine.md` §3 and `spec/tx-types.md` §1.
 */

import type {
  ActionNonce,
  GameId,
  Hash256,
  Pubkey33,
  RoundNumber,
  Satoshis,
  Seat,
} from './primitives.js';
import type { RevealProof } from './cards.js';

/** Every action type a player or auto-trigger can produce. */
export type ActionType =
  | 'Join'
  | 'EntropyCommit'
  | 'EntropyReveal'
  | 'CardReveal'
  | 'BetAction'
  | 'Pass'
  | 'Fold'
  | 'Settle'
  | 'RotateTurn'
  | 'TableLock'
  | 'TableClose'
  | 'Timeout'
  | 'Recovery';

/**
 * Base shape every signed action commits to. The signature scope per
 * `spec/serialisation.md` §6 covers the canonical encoding of this
 * record with the signature field zeroed.
 */
export interface SignedActionBase {
  readonly game_id: GameId;
  readonly round_number: RoundNumber;
  readonly referenced_state_hash: Hash256;
  readonly action_type: ActionType;
  readonly action_nonce: ActionNonce;
  readonly acting_player_seat: Seat | null;
  readonly authorising_signature: string;
  /** Hash of the state the action transitions to. */
  readonly successor_state_commitment: Hash256;
}

/** Join action carries the player's pubkey and stake amount. */
export interface JoinAction extends SignedActionBase {
  readonly action_type: 'Join';
  readonly player_pubkey: Pubkey33;
  readonly stake_amount: Satoshis;
}

/** Entropy commitment publishes only the hash; reveal comes later. */
export interface EntropyCommitAction extends SignedActionBase {
  readonly action_type: 'EntropyCommit';
  readonly commitment_hash: Hash256;
}

/** Entropy reveal opens the prior commitment. */
export interface EntropyRevealAction extends SignedActionBase {
  readonly action_type: 'EntropyReveal';
  readonly entropy: Hash256;
}

/** Card reveal opens one deck position. */
export interface CardRevealAction extends SignedActionBase {
  readonly action_type: 'CardReveal';
  readonly reveal: RevealProof;
}

/** Bet action commits a bet amount at S8 BET_DECISION. */
export interface BetAction extends SignedActionBase {
  readonly action_type: 'BetAction';
  readonly bet_amount: Satoshis;
}

/** Pass — no economic change, used as legitimate default at S8. */
export interface PassAction extends SignedActionBase {
  readonly action_type: 'Pass';
}

/** Fold — extended model only; not used by In-Between v1. */
export interface FoldAction extends SignedActionBase {
  readonly action_type: 'Fold';
}

/** Settle — resolve the round outcome. */
export interface SettleAction extends SignedActionBase {
  readonly action_type: 'Settle';
}

/** Rotate to next player. */
export interface RotateTurnAction extends SignedActionBase {
  readonly action_type: 'RotateTurn';
}

/** Lock the table once player_count_min met. */
export interface TableLockAction extends SignedActionBase {
  readonly action_type: 'TableLock';
}

/** Close the table after the final round. */
export interface TableCloseAction extends SignedActionBase {
  readonly action_type: 'TableClose';
}

/** Timeout default — broadcast by any participant past the decision deadline. */
export interface TimeoutAction extends SignedActionBase {
  readonly action_type: 'Timeout';
  readonly default_consequence: ActionType;
  readonly silenced_seat: Seat;
}

/** Recovery — pre-signed tx whose `nLockTime` is the absolute recovery height. */
export interface RecoveryAction extends SignedActionBase {
  readonly action_type: 'Recovery';
  readonly recovery_trigger: string;
}

/** Discriminated union over every action type. */
export type SignedAction =
  | JoinAction
  | EntropyCommitAction
  | EntropyRevealAction
  | CardRevealAction
  | BetAction
  | PassAction
  | FoldAction
  | SettleAction
  | RotateTurnAction
  | TableLockAction
  | TableCloseAction
  | TimeoutAction
  | RecoveryAction;
