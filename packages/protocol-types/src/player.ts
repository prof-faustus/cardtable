/**
 * Player and WalletIdentity types.
 *
 * Per the per-player and wallet-identity fields used throughout the
 * spec and test vectors.
 */

import type { Hash256, Outpoint, PlayerId, Pubkey33, Satoshis, Seat } from './primitives.js';

/**
 * Participation lifecycle status for one player in one session.
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
  /**
   * The hash committed in the EntropyCommit action — null until that
   * action lands. On EntropyReveal, the verification wrapper consults
   * this field; the reveal is rejected if the recomputed hash differs.
   */
  readonly entropy_commitment_hash: Hash256 | null;
  /** Has this player revealed entropy at S4 ENTROPY_REVEAL? */
  readonly entropy_revealed: boolean;
  /**
   * The plaintext entropy revealed by this player — null until that
   * action lands. Stored so honest engines can reproduce the combined
   * entropy and the deck commitment on the S4 -> S5 transition.
   */
  readonly entropy_value: Hash256 | null;
  /** Concealed-card UTXOs held by this player (extended model only). */
  readonly concealed_card_refs: readonly Outpoint[];
  /** Per-state default-action preferences chosen at session start. */
  readonly default_preferences: Readonly<Record<string, string>>;
}
