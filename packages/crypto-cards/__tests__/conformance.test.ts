import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildDeckCommitment,
  combineEntropy,
  commitEntropy,
  fromHex,
  toHex,
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

const vector = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../spec/test-vectors/mental-poker.json'),
    'utf8',
  ),
) as VectorFile;

// Canonical hex values pinned by the cross-language conformance run.
// The Go reference at apps/relay-go/pkg/cryptocards asserts the same
// strings; both implementations MUST agree on every line. If either
// side disagrees, the protocol has diverged and CI fails.
const EXPECTED_FIRST_SHUFFLED_ORDINAL = 6;
const EXPECTED_COMMITMENT_SEAT_0 = '3df87bf0050b68c9991f0f297a393f3bd1c60b9fd14f46759472798b03879f56';
const EXPECTED_COMBINED_ENTROPY = 'd51fb438af0eff4de957ccf3c3378c712228d937939c74251c5bcae0760ab380';
const EXPECTED_DECK_COMMITMENT_HASH = '13b01e0dcbbaa3e886171f0a0f006b9fcaabab6197660270523e73900fb45328';

describe('cross-language conformance — TS side', () => {
  it('matches the pinned canonical hex outputs', async () => {
    const gameId = fromHex(vector.inputs.game_id_hex);
    const players = vector.inputs.players.map((p) => ({
      seat: p.seat,
      playerId: fromHex(p.player_id_hex),
      entropy: fromHex(p.entropy_hex),
    }));
    const commitments: string[] = [];
    for (const p of players) {
      const c = await commitEntropy(p.entropy, p.playerId, gameId);
      commitments.push(toHex(c));
    }
    const combined = await combineEntropy(players.map((p) => p.entropy));
    const combinedHex = toHex(combined);

    const dc = await buildDeckCommitment(combined, vector.inputs.deck_size, vector.inputs.shuffle_algorithm_version);
    const deckHashHex = toHex(dc.deckCommitmentHash);

    expect(dc.shuffledDeck[0]).toBe(EXPECTED_FIRST_SHUFFLED_ORDINAL);
    expect(commitments[0]).toBe(EXPECTED_COMMITMENT_SEAT_0);
    expect(combinedHex).toBe(EXPECTED_COMBINED_ENTROPY);
    expect(deckHashHex).toBe(EXPECTED_DECK_COMMITMENT_HASH);
  });
});
