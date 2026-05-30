/**
 * Entropy commitment and reveal — the first half of the verifiable
 * distributed shuffle.
 *
 * Each seated player publishes a commitment hash before any reveal
 * is broadcast (the commit window). After every commit lands, players
 * release their entropy in the reveal window; the engine verifies the
 * revealed plaintext hashes back to the prior commitment.
 *
 * The combined entropy is then computed deterministically from every
 * revealed value, seat-indexed.
 */

import {
  TAG_DECK_COMMITMENT,
  TAG_ENTROPY_COMMITMENT,
  domainHash,
} from './hash.js';
import { encodeBytes32, encodeVarint, toHex } from './encode.js';

/**
 * Build a player's entropy commitment.
 *
 *   commitment = H_tag( entropy || playerId || gameId )
 *
 * All three inputs are 32-byte values. The returned hash is 32 bytes.
 */
export async function commitEntropy(
  entropy: Uint8Array,
  playerId: Uint8Array,
  gameId: Uint8Array,
): Promise<Uint8Array> {
  return domainHash(
    TAG_ENTROPY_COMMITMENT,
    encodeBytes32(entropy),
    encodeBytes32(playerId),
    encodeBytes32(gameId),
  );
}

/** Verify that a revealed entropy plaintext matches its commitment. */
export async function verifyEntropyReveal(
  commitment: Uint8Array,
  entropy: Uint8Array,
  playerId: Uint8Array,
  gameId: Uint8Array,
): Promise<boolean> {
  const recomputed = await commitEntropy(entropy, playerId, gameId);
  return constantTimeEquals(recomputed, commitment);
}

/**
 * Combine an ordered (by seat ascending) list of revealed entropies into
 * the session's deterministic seed.
 *
 *   combined = H_DeckCommitment( encode_array(entropies) )
 *
 * where `encode_array(...)` is `varint(count) || e_1 || ... || e_n`.
 */
export async function combineEntropy(entropies: readonly Uint8Array[]): Promise<Uint8Array> {
  if (entropies.length === 0) {
    throw new Error('combineEntropy: empty list');
  }
  const parts: Uint8Array[] = [encodeVarint(entropies.length)];
  for (const e of entropies) {
    parts.push(encodeBytes32(e));
  }
  return domainHash(TAG_DECK_COMMITMENT, ...parts);
}

/** Constant-time byte-wise comparison. */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/** Convenience: hex-encoded variant of commitEntropy. */
export async function commitEntropyHex(
  entropy: Uint8Array,
  playerId: Uint8Array,
  gameId: Uint8Array,
): Promise<string> {
  return toHex(await commitEntropy(entropy, playerId, gameId));
}
