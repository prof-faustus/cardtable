import { describe, it, expect } from 'vitest';
import {
  cardOrdinal,
  cardFromOrdinal,
  RANKS_IN_ORDER,
  SUITS_IN_ORDER,
} from '../src/index.js';

describe('canonical card ordinals', () => {
  it('2 of clubs is ordinal 0', () => {
    expect(cardOrdinal('2', 'clubs')).toBe(0);
  });

  it('A of spades is ordinal 51', () => {
    expect(cardOrdinal('A', 'spades')).toBe(51);
  });

  it('K of hearts is ordinal 11 within hearts suit (suit_idx=2, rank_idx=11) -> 13*2 + 11 = 37', () => {
    expect(cardOrdinal('K', 'hearts')).toBe(37);
  });

  it('cardFromOrdinal is inverse of cardOrdinal across the whole deck', () => {
    for (let i = 0; i < 52; i++) {
      const c = cardFromOrdinal(i);
      expect(cardOrdinal(c.rank, c.suit)).toBe(i);
      expect(c.ordinal).toBe(i);
    }
  });

  it('rejects out-of-range ordinals', () => {
    expect(() => cardFromOrdinal(-1)).toThrow();
    expect(() => cardFromOrdinal(52)).toThrow();
  });

  it('canonical orders are stable', () => {
    expect(RANKS_IN_ORDER).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
    expect(SUITS_IN_ORDER).toEqual(['clubs', 'diamonds', 'hearts', 'spades']);
  });
});
