import { describe, it } from 'vitest';
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

describe('cross-language conformance — TS side', () => {
  it('emits deterministic hex outputs that the Go reference must agree on', async () => {
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

    // Log under stdout so CI surfaces the values; both languages MUST
    // print the same hex strings here when the conformance lock-in
    // commit is taken.
    // eslint-disable-next-line no-console
    console.log(`first_shuffled_ordinal_ts=${dc.shuffledDeck[0]}`);
    // eslint-disable-next-line no-console
    console.log(`commitment_seat_0_ts=${commitments[0]}`);
    // eslint-disable-next-line no-console
    console.log(`combined_entropy_ts=${combinedHex}`);
    // eslint-disable-next-line no-console
    console.log(`deck_commitment_hash_ts=${deckHashHex}`);
  });
});
