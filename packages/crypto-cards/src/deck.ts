/**
 * Per-position card commitments and reveal-proof verification.
 *
 * The MVP commitment-based deck binds every card position to a
 * domain-separated hash of (ordinal, card_nonce, deck_nonce). The
 * `card_nonce` and `deck_nonce` are derived deterministically from the
 * combined entropy so that two honest engines compute byte-identical
 * commitments without needing to exchange them out-of-band.
 *
 * Determinism: every honest engine that holds the combined entropy of
 * the session computes the same deck commitment. The protocol guarantee
 * here is **integrity** — once `combined` is fixed, no participant can
 * forge a reveal that opens to a different ordinal.
 *
 * For information-theoretic concealment of unrevealed cards (the
 * extended one-UTXO-per-card model) see `spec/card-protocol.md` §6 and
 * the forthcoming `crypto-cards/src/conceal.ts` (Phase 4+ extended).
 */

import { concat, encodeBytes32, encodeU16LE, encodeU32LE, encodeU8 } from './encode.js';
import { TAG_CARD, TAG_DECK_COMMITMENT, domainHash, sha256 } from './hash.js';
import { constantTimeEquals } from './entropy.js';
import { shuffleCanonicalDeck } from './shuffle.js';

/** One position's commitment in the shuffled deck. */
export interface CardCommitment {
  readonly position: number;
  readonly ordinal: number;
  readonly cardNonce: Uint8Array;
  readonly deckNonce: Uint8Array;
  readonly commitment: Uint8Array;
}

/** Full DeckCommitment object — analogue of the protocol-types interface. */
export interface DeckCommitment {
  readonly combinedEntropy: Uint8Array;
  readonly shuffleAlgorithmVersion: number;
  readonly shuffledDeck: readonly number[];
  readonly perPosition: readonly CardCommitment[];
  /** Hash of the array of per-position commitments. */
  readonly deckCommitmentHash: Uint8Array;
}

/**
 * The single deterministic deck nonce, derived from the combined
 * entropy. Same for every position; the `card_nonce` provides per-
 * position uniqueness inside each commitment input.
 */
async function deriveDeckNonce(combined: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(encodeU16LE(TAG_DECK_COMMITMENT), combined, new TextEncoder().encode('deck-nonce')));
}

/**
 * The per-position card nonce. Each position gets its own
 * deterministic 32-byte nonce so the commitments at different
 * positions cannot trivially collide.
 */
async function deriveCardNonce(combined: Uint8Array, position: number): Promise<Uint8Array> {
  return sha256(
    concat(
      encodeU16LE(TAG_CARD),
      combined,
      new TextEncoder().encode('card-nonce'),
      encodeU32LE(position),
    ),
  );
}

/**
 * Compute one position's commitment hash:
 *
 *   H_Card( u8(ordinal) || bytes32(cardNonce) || bytes32(deckNonce) )
 */
export async function commitCard(
  ordinal: number,
  cardNonce: Uint8Array,
  deckNonce: Uint8Array,
): Promise<Uint8Array> {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 53) {
    throw new Error(`commitCard: ordinal out of 0..53 range: ${ordinal}`);
  }
  return domainHash(TAG_CARD, encodeU8(ordinal), encodeBytes32(cardNonce), encodeBytes32(deckNonce));
}

/**
 * Build the full deck commitment from the combined entropy. Pure
 * function: same input → same output.
 */
export async function buildDeckCommitment(
  combined: Uint8Array,
  deckSize: number,
  shuffleAlgorithmVersion: number,
): Promise<DeckCommitment> {
  if (shuffleAlgorithmVersion !== 1) {
    throw new Error(`buildDeckCommitment: unsupported shuffle algorithm version ${shuffleAlgorithmVersion}`);
  }
  const shuffled = await shuffleCanonicalDeck(combined, deckSize);
  const deckNonce = await deriveDeckNonce(combined);
  const perPosition: CardCommitment[] = [];
  for (let i = 0; i < shuffled.length; i++) {
    const ordinal = shuffled[i] as number;
    const cardNonce = await deriveCardNonce(combined, i);
    const commitment = await commitCard(ordinal, cardNonce, deckNonce);
    perPosition.push({ position: i, ordinal, cardNonce, deckNonce, commitment });
  }
  const aggParts: Uint8Array[] = [encodeU8(shuffleAlgorithmVersion)];
  for (const p of perPosition) aggParts.push(p.commitment);
  const deckCommitmentHash = await domainHash(TAG_DECK_COMMITMENT, ...aggParts);
  return {
    combinedEntropy: combined,
    shuffleAlgorithmVersion,
    shuffledDeck: shuffled,
    perPosition,
    deckCommitmentHash,
  };
}

/** Public reveal-proof shape — identical structure to `protocol-types.RevealProof`. */
export interface RevealProof {
  readonly position: number;
  readonly ordinal: number;
  readonly cardNonce: Uint8Array;
  readonly deckNonce: Uint8Array;
}

/**
 * Verify a reveal proof opens the named position to the named ordinal
 * by recomputing the commitment.
 */
export async function verifyRevealProof(
  expectedCommitment: Uint8Array,
  proof: RevealProof,
): Promise<boolean> {
  const recomputed = await commitCard(proof.ordinal, proof.cardNonce, proof.deckNonce);
  return constantTimeEquals(recomputed, expectedCommitment);
}
