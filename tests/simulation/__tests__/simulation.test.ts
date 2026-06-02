/**
 * Multi-round simulation invariants.
 */

import { describe, expect, it } from 'vitest';
import { makeRuleSet, mulberry32, simulate, simulateRound } from '../src/sim.js';

describe('seeded multi-round simulation', () => {
  it('drives a round to S11 with the pot reflecting the bet at S9', async () => {
    const r = await simulateRound(37);
    expect(r.finalStateClass).toBe('S11_ROTATE_TURN');
    expect(r.betAmount).toBe(37);
    expect(r.potAfterBet).toBe(37); // only the bet entered the pot
    expect(r.stepCount).toBe(12);
  });

  it('every round in a run ends terminal with a bounded bet', async () => {
    const rs = makeRuleSet();
    const min = Number(rs.min_bet);
    const max = Number(rs.max_bet);
    const run = await simulate(0xc0ffee, 8);
    expect(run).toHaveLength(8);
    for (const r of run) {
      expect(r.finalStateClass).toBe('S11_ROTATE_TURN');
      expect(r.betAmount).toBeGreaterThanOrEqual(min);
      expect(r.betAmount).toBeLessThanOrEqual(max);
      expect(r.potAfterBet).toBe(r.betAmount); // pot conservation at the bet step
    }
  });

  it('is deterministic by seed — same seed reproduces the run exactly', async () => {
    const a = await simulate(12345, 6);
    const b = await simulate(12345, 6);
    expect(a.map((r) => r.betAmount)).toEqual(b.map((r) => r.betAmount));
    expect(a.map((r) => r.finalStateHash)).toEqual(b.map((r) => r.finalStateHash));
  });

  it('different seeds produce different bet sequences', async () => {
    const a = await simulate(1, 10);
    const b = await simulate(2, 10);
    expect(a.map((r) => r.betAmount)).not.toEqual(b.map((r) => r.betAmount));
  });

  it('the PRNG itself is deterministic and in [0,1)', () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('the same bet always yields the same final state hash (engine determinism)', async () => {
    const a = await simulateRound(50);
    const b = await simulateRound(50);
    expect(a.finalStateHash).toBe(b.finalStateHash);
  });
});
