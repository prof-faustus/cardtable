/**
 * Card types — canonical deck definition, commitments, reveal proofs.
 *
 * Per `spec/card-protocol.md`. The 52-card variant is the In-Between v1
 * default; the 54-card variant (with two jokers) is supported via
 * `deck_format = 54` in the RuleSet.
 */

import type { Hash256, Outpoint, Pubkey33 } from './primitives.js';

/** Canonical suits in canonical order. */
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

/** Canonical ranks in canonical order (2 lowest, A highest). */
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

export const SUITS_IN_ORDER: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export const RANKS_IN_ORDER: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

/** A revealed card face — value present, plaintext-on-chain. */
export interface RevealedCard {
  readonly rank: Rank;
  readonly suit: Suit;
  /** Canonical ordinal 0-51 (or 52/53 for jokers in deck_format=54). */
  readonly ordinal: number;
}

/**
 * Cardinal ordinal of a (rank, suit) pair in the 52-card canonical deck.
 * `ordinal = 13 * suit_index + rank_index`.
 */
export function cardOrdinal(rank: Rank, suit: Suit): number {
  const r = RANKS_IN_ORDER.indexOf(rank);
  const s = SUITS_IN_ORDER.indexOf(suit);
  if (r === -1 || s === -1) {
    throw new Error(`cardOrdinal: invalid rank/suit (${rank}, ${suit})`);
  }
  return 13 * s + r;
}

/**
 * Inverse of {@link cardOrdinal}: recover the (rank, suit) for a 52-card
 * canonical ordinal.
 */
export function cardFromOrdinal(ordinal: number): RevealedCard {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 51) {
    throw new Error(`cardFromOrdinal: ordinal out of 52-card range: ${ordinal}`);
  }
  const suit = SUITS_IN_ORDER[Math.floor(ordinal / 13)];
  const rank = RANKS_IN_ORDER[ordinal % 13];
  if (suit === undefined || rank === undefined) {
    throw new Error(`cardFromOrdinal: indexing failure for ${ordinal}`);
  }
  return { rank, suit, ordinal };
}

/**
 * Per-position card commitment used in `DeckCommitment.hidden_card_commitments`.
 * Used by both the MVP commitment-based deck and the extended one-UTXO-per-card
 * model (Phase 4+).
 */
export interface CardCommitment {
  /** Position in the shuffled deck, 0-based. */
  readonly position: number;
  /** Domain-separated hash of (ordinal, card_nonce, deck_nonce). */
  readonly card_commitment: Hash256;
  /** Per-position nonce, revealed at CardReveal time. */
  readonly card_nonce: Hash256;
}

/**
 * Card lifecycle states for the extended one-UTXO-per-card model.
 *
 * The named values below are the canonical set every reference
 * implementation supports. Game variants beyond In-Between MAY
 * extend the lifecycle with their own state names (e.g. poker
 * variants might add `MUCKED`, `BURNT`, `BOARD`) — the union
 * includes `(string & {})` to permit arbitrary strings at runtime
 * while keeping autocomplete on the canonical members.
 *
 * Engine handlers (e.g. `applyFold`) only act on the canonical
 * states; variant-specific states pass through unchanged.
 */
export type CardLifecycleState =
  | 'UNDEALT'
  | 'ASSIGNED_CONCEALED'
  | 'REVEALED'
  | 'SURRENDERED'
  | 'RETIRED'
  | (string & {});

/** The canonical lifecycle set; useful for runtime validation. */
export const CANONICAL_LIFECYCLE_STATES = [
  'UNDEALT',
  'ASSIGNED_CONCEALED',
  'REVEALED',
  'SURRENDERED',
  'RETIRED',
] as const;

/**
 * Concealed card object (extended model only). Carries the encrypted
 * payload deliverable to the holder's `card_encryption_pubkey`.
 */
export interface ConcealedCard {
  readonly card_commitment: CardCommitment;
  /** Compact-encoded ciphertext addressable to the holder. */
  readonly ciphertext: string;
  /** Outpoint of the card UTXO's current locking script. */
  readonly custody_outpoint: Outpoint;
  readonly holder_pubkey: Pubkey33;
  readonly lifecycle_state: CardLifecycleState;
}

/**
 * Proof opening a card commitment at a specific deck position. The
 * domain-separated hash of (ordinal, card_nonce, deck_nonce) must equal
 * `commitment.card_commitment` for the reveal to be valid.
 */
export interface RevealProof {
  readonly position: number;
  readonly revealed_card: RevealedCard;
  readonly card_nonce: Hash256;
  readonly deck_nonce: Hash256;
}

/**
 * Deck commitment object anchored on-chain by `TXC_DECK_COMMIT`.
 */
export interface DeckCommitment {
  readonly combined_entropy: Hash256;
  readonly shuffle_algorithm_version: number;
  readonly deck_commitment_hash: Hash256;
  readonly hidden_card_commitments: readonly CardCommitment[];
  readonly reveal_history: readonly RevealProof[];
}
