/**
 * Verifiable distributed shuffle.
 *
 * A pseudorandom byte stream is derived from the combined entropy by
 * SHA-256 in counter mode, then consumed by Fisher-Yates with
 * rejection sampling to produce an unbiased permutation of the
 * canonical deck.
 *
 * Note on PRG choice: ADR-001 records the substitution of SHA-256
 * counter mode for the spec's earlier Keccak-256 stream — see
 * docs/adr/001-sha256-counter-prg-for-shuffle.md. Both implementations
 * MUST agree byte-for-byte with `spec/test-vectors/mental-poker.json`.
 */

import { concat, encodeU32LE } from './encode.js';
import { sha256 } from './hash.js';

/** A byte-stream PRG seeded by a 32-byte combined-entropy seed. */
class Sha256CounterPrg {
  private buf: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private counter = 0;
  constructor(private readonly seed: Uint8Array) {
    if (seed.byteLength !== 32) {
      throw new Error(`Sha256CounterPrg: seed must be 32 bytes, got ${seed.byteLength}`);
    }
  }
  async nextByte(): Promise<number> {
    if (this.offset >= this.buf.byteLength) {
      this.buf = await sha256(concat(this.seed, encodeU32LE(this.counter)));
      this.counter += 1;
      this.offset = 0;
    }
    const out = this.buf[this.offset] as number;
    this.offset += 1;
    return out;
  }
  /** Draw an integer uniformly in [0, max] using rejection sampling. */
  async drawUniform(max: number): Promise<number> {
    if (max < 0 || max > 0xffffffff) {
      throw new Error(`drawUniform: max out of range: ${max}`);
    }
    if (max === 0) return 0;
    // Smallest threshold so that `value < threshold` produces an
    // unbiased value in [0, max] when reduced mod (max+1). We do
    // rejection sampling for full uniformity.
    const bound = max + 1;
    const limit = Math.floor(0x100000000 / bound) * bound;
    for (;;) {
      const b0 = await this.nextByte();
      const b1 = await this.nextByte();
      const b2 = await this.nextByte();
      const b3 = await this.nextByte();
      const value = ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0);
      if (value < limit) {
        return value % bound;
      }
    }
  }
}

/**
 * Fisher-Yates shuffle of `[0, 1, ..., deckSize-1]` driven by the
 * SHA-256 counter-mode PRG.
 */
export async function shuffleCanonicalDeck(
  combined: Uint8Array,
  deckSize: number,
): Promise<readonly number[]> {
  if (deckSize !== 52 && deckSize !== 54) {
    throw new Error(`shuffleCanonicalDeck: unsupported deckSize ${deckSize}`);
  }
  const deck: number[] = [];
  for (let i = 0; i < deckSize; i++) deck.push(i);
  const prg = new Sha256CounterPrg(combined);
  for (let i = deckSize - 1; i >= 1; i--) {
    const j = await prg.drawUniform(i);
    const tmp = deck[i] as number;
    deck[i] = deck[j] as number;
    deck[j] = tmp;
  }
  return deck;
}
