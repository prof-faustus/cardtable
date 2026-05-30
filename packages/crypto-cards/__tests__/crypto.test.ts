import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildDeckCommitment,
  combineEntropy,
  commitEntropy,
  fromHex,
  shuffleCanonicalDeck,
  toHex,
  verifyEntropyReveal,
  verifyRevealProof,
} from '../src/index.js';

interface VectorPlayer {
  readonly seat: number;
  readonly player_id_hex: string;
  readonly entropy_hex: string;
}
interface VectorFile {
  readonly inputs: {
    readonly game_id_hex: string;
    readonly deck_size: number;
    readonly shuffle_algorithm_version: number;
    readonly players: readonly VectorPlayer[];
    readonly reveal_position: number;
  };
}

const vectorPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../spec/test-vectors/mental-poker.json',
);
const vector = JSON.parse(readFileSync(vectorPath, 'utf8')) as VectorFile;

describe('mental-poker crypto — commit/reveal/verify roundtrip', () => {
  it('commitEntropy is deterministic and verifyEntropyReveal accepts the matching plaintext', async () => {
    const p = vector.inputs.players[0]!;
    const entropy = fromHex(p.entropy_hex);
    const playerId = fromHex(p.player_id_hex);
    const gameId = fromHex(vector.inputs.game_id_hex);

    const first = await commitEntropy(entropy, playerId, gameId);
    const second = await commitEntropy(entropy, playerId, gameId);
    expect(toHex(first)).toEqual(toHex(second));
    expect(first.byteLength).toBe(32);

    expect(await verifyEntropyReveal(first, entropy, playerId, gameId)).toBe(true);

    // Tampered entropy must reject.
    const bad = new Uint8Array(entropy);
    bad[0] ^= 0xff;
    expect(await verifyEntropyReveal(first, bad, playerId, gameId)).toBe(false);
  });

  it('combineEntropy is deterministic and order-sensitive', async () => {
    const entropies = vector.inputs.players.map((p) => fromHex(p.entropy_hex));
    const a = await combineEntropy(entropies);
    const b = await combineEntropy(entropies);
    expect(toHex(a)).toEqual(toHex(b));
    expect(a.byteLength).toBe(32);

    // Swapping the order MUST change the result.
    const swapped = [entropies[1]!, entropies[0]!, entropies[2]!];
    const c = await combineEntropy(swapped);
    expect(toHex(c)).not.toEqual(toHex(a));
  });

  it('shuffleCanonicalDeck yields a permutation of 0..deckSize-1', async () => {
    const entropies = vector.inputs.players.map((p) => fromHex(p.entropy_hex));
    const combined = await combineEntropy(entropies);
    const deck = await shuffleCanonicalDeck(combined, vector.inputs.deck_size);
    expect(deck).toHaveLength(vector.inputs.deck_size);
    const sorted = [...deck].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      expect(sorted[i]).toBe(i);
    }
  });

  it('shuffleCanonicalDeck is deterministic for the same combined entropy', async () => {
    const entropies = vector.inputs.players.map((p) => fromHex(p.entropy_hex));
    const combined = await combineEntropy(entropies);
    const a = await shuffleCanonicalDeck(combined, 52);
    const b = await shuffleCanonicalDeck(combined, 52);
    expect(a).toEqual(b);
  });

  it('buildDeckCommitment + verifyRevealProof: accepts an honest open, rejects a forged ordinal', async () => {
    const entropies = vector.inputs.players.map((p) => fromHex(p.entropy_hex));
    const combined = await combineEntropy(entropies);
    const dc = await buildDeckCommitment(combined, vector.inputs.deck_size, vector.inputs.shuffle_algorithm_version);

    const pos = vector.inputs.reveal_position;
    const honest = dc.perPosition[pos]!;
    const ok = await verifyRevealProof(honest.commitment, {
      position: honest.position,
      ordinal: honest.ordinal,
      cardNonce: honest.cardNonce,
      deckNonce: honest.deckNonce,
    });
    expect(ok).toBe(true);

    // Forge the ordinal — verifier must reject.
    const forged = await verifyRevealProof(honest.commitment, {
      position: honest.position,
      ordinal: (honest.ordinal + 1) % 52,
      cardNonce: honest.cardNonce,
      deckNonce: honest.deckNonce,
    });
    expect(forged).toBe(false);
  });

  it('deckCommitmentHash binds the entire shuffled deck (changing one entropy changes the hash)', async () => {
    const entropies = vector.inputs.players.map((p) => fromHex(p.entropy_hex));
    const combinedA = await combineEntropy(entropies);
    const dcA = await buildDeckCommitment(combinedA, 52, 1);

    const flipped = new Uint8Array(entropies[0]!);
    flipped[0] ^= 0xff;
    const combinedB = await combineEntropy([flipped, entropies[1]!, entropies[2]!]);
    const dcB = await buildDeckCommitment(combinedB, 52, 1);

    expect(toHex(dcA.deckCommitmentHash)).not.toEqual(toHex(dcB.deckCommitmentHash));
  });
});
