/**
 * Player and WalletIdentity types.
 *
 * Per `Formal_Architecture` §3.2.1 / §3.2.2.
 */

import type { Outpoint, PlayerId, Pubkey33, Satoshis, Seat } from './primitives.js';

/**
 * Participation lifecycle status for one player in one session. See
 * `Formal_Architecture` §3.2.1.
 */
export type ParticipationStatus =
  | 'invited'
  | 'joined'
  | 'ready'
  | 'active'
  | 'folded'
  | 'settled'
  | 'disconnected'
  | 'timed_out'
  | 'forfeited';

/**
 * Cross-session wallet identity. The three public keys are role-separated
 * to permit independent rotation of session messaging keys without
 * touching long-term value-signing keys.
 */
export interface WalletIdentity {
  readonly value_signing_pubkey: Pubkey33;
  readonly session_messaging_pubkey: Pubkey33;
  readonly card_encryption_pubkey: Pubkey33;
}

/**
 * One player's participation in one session. The `stake_outpoint` is
 * populated after Join confirms; the `concealed_card_refs` field is
 * populated only in the extended one-UTXO-per-card model (Phase 4+).
 */
export interface PlayerState {
  readonly seat: Seat;
  readonly player_id: PlayerId;
  readonly value_signing_pubkey: Pubkey33;
  readonly participation_status: ParticipationStatus;
  readonly stake_at_risk: Satoshis;
  /** Outpoint of the player's stake output; undefined before Join confirms. */
  readonly stake_outpoint?: Outpoint;
  /** Has this player committed entropy at S3 ENTROPY_COMMIT? */
  readonly entropy_committed: boolean;
  /** Has this player revealed entropy at S4 ENTROPY_REVEAL? */
  readonly entropy_revealed: boolean;
  /** Concealed-card UTXOs held by this player (extended model only). */
  readonly concealed_card_refs: readonly Outpoint[];
  /** Per-state default-action preferences chosen at session start. */
  readonly default_preferences: Readonly<Record<string, string>>;
}
