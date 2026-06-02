/**
 * Deck-simulator unit tests — determinism + the three reveal outcomes.
 */

import { describe, expect, it } from 'vitest';
import { buildDeck, forgeReveal, honestReveal, simulateDeck } from '../src/simulate.js';

const ENTROPIES = [
  '0202020202020202020202020202020202020202020202020202020202020202',
  '0404040404040404040404040404040404040404040404040404040404040404',
];

describe('deck-simulator', () => {
  it('is deterministic: identical entropy => identical commitment + deck', async () => {
    const a = await simulateDeck({ entropiesHex: ENTROPIES, positions: [0, 1, 2] });
    const b = await simulateDeck({ entropiesHex: ENTROPIES, positions: [0, 1, 2] });
    expect(a.deckCommitmentHashHex).toBe(b.deckCommitmentHashHex);
    expect(a.combinedEntropyHex).toBe(b.combinedEntropyHex);
    expect(a.shuffledDeck).toEqual(b.shuffledDeck);
    expect(a.reveals).toEqual(b.reveals);
  });

  it('different entropy ordering changes the deck (entropy is order-sensitive input)', async () => {
    const a = await simulateDeck({ entropiesHex: ENTROPIES });
    const b = await simulateDeck({ entropiesHex: [...ENTROPIES].reverse() });
    // combineEntropy is over the supplied order; honest sessions sort by
    // seat before combining, so a reversed list is a different combined value.
    expect(a.combinedEntropyHex).not.toBe(b.combinedEntropyHex);
  });

  it('produces a full 52-card permutation by default', async () => {
    const r = await simulateDeck({ entropiesHex: ENTROPIES });
    expect(r.deckSize).toBe(52);
    expect(r.shuffledDeck).toHaveLength(52);
    expect(new Set(r.shuffledDeck).size).toBe(52);
    expect(Math.min(...r.shuffledDeck)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...r.shuffledDeck)).toBeLessThanOrEqual(51);
  });

  it('honest reveals all verify', async () => {
    const r = await simulateDeck({ entropiesHex: ENTROPIES, positions: [0, 1, 2, 17, 51] });
    expect(r.reveals).toHaveLength(5);
    for (const rev of r.reveals) {
      expect(rev.kind).toBe('honest');
      expect(rev.verifies).toBe(true);
    }
  });

  it('forged reveal (wrong ordinal, real nonces) fails verification', async () => {
    const dc = await buildDeck(ENTROPIES);
    const honest = await honestReveal(dc, 0);
    const wrong = (honest.ordinal + 1) % 52;
    const forged = await forgeReveal(dc, 0, wrong);
    expect(forged.kind).toBe('forged');
    expect(forged.verifies).toBe(false);
    // The forged commitment differs from the honest one at that position.
    expect(forged.commitmentHex).not.toBe(honest.commitmentHex);
  });

  it('forgeReveal refuses to "forge" the honest ordinal', async () => {
    const dc = await buildDeck(ENTROPIES);
    const honest = await honestReveal(dc, 5);
    await expect(forgeReveal(dc, 5, honest.ordinal)).rejects.toThrow();
  });

  it('withheld reveal is modelled by simply omitting the position', async () => {
    const all = await simulateDeck({ entropiesHex: ENTROPIES });
    const withheld = await simulateDeck({
      entropiesHex: ENTROPIES,
      positions: all.reveals.filter((r) => r.position !== 0).map((r) => r.position),
    });
    expect(withheld.reveals.find((r) => r.position === 0)).toBeUndefined();
    expect(withheld.reveals).toHaveLength(all.reveals.length - 1);
  });

  it('rejects an empty entropy set', async () => {
    await expect(buildDeck([])).rejects.toThrow();
  });
});
