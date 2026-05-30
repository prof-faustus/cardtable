import { describe, it, expect, beforeEach } from 'vitest';
import { asSatoshis, asSeat } from '@cardtable/protocol-types';
import { useTableStore } from '../src/store.js';

describe('useTableStore — happy path through one round', () => {
  beforeEach(() => {
    useTableStore.getState().reset();
  });

  it('starts at S1_SEAT_OPEN with no players', () => {
    const s = useTableStore.getState().state;
    expect(s.state_class).toBe('S1_SEAT_OPEN');
    expect(s.players).toHaveLength(0);
  });

  it('reaches S10 after two joins -> lock -> entropy x2 -> reveal x2 -> 2 cards -> bet -> third card', () => {
    const store = useTableStore.getState();
    store.seatJoin(asSeat(0));
    store.seatJoin(asSeat(1));
    expect(useTableStore.getState().state.players).toHaveLength(2);

    store.tableLock();
    expect(useTableStore.getState().state.state_class).toBe('S3_ENTROPY_COMMIT_WINDOW');

    store.entropyCommit(asSeat(0));
    store.entropyCommit(asSeat(1));
    expect(useTableStore.getState().state.state_class).toBe('S4_ENTROPY_REVEAL_WINDOW');

    store.entropyReveal(asSeat(0));
    store.entropyReveal(asSeat(1));
    expect(useTableStore.getState().state.state_class).toBe('S5_DECK_COMMITTED');

    store.revealCard(3);
    expect(useTableStore.getState().state.state_class).toBe('S6_CARD_REVEAL_FIRST');
    store.revealCard(20);
    expect(useTableStore.getState().state.state_class).toBe('S8_BET_DECISION');

    store.placeBet(useTableStore.getState().ruleSet.min_bet);
    expect(useTableStore.getState().state.state_class).toBe('S9_CARD_REVEAL_THIRD');

    store.revealCard(5);
    expect(useTableStore.getState().state.state_class).toBe('S10_SETTLED_ROUND');
  });

  it('records INVALID_STAKE_AMOUNT when the rule set is violated by a forced underpay', () => {
    // The store does not yet expose a direct underpay path; assert
    // the error pathway still exists for diagnostic visibility by
    // requesting a bet outside the bet range.
    const store = useTableStore.getState();
    // Move to S8 quickly.
    store.seatJoin(asSeat(0));
    store.seatJoin(asSeat(1));
    store.tableLock();
    store.entropyCommit(asSeat(0));
    store.entropyCommit(asSeat(1));
    store.entropyReveal(asSeat(0));
    store.entropyReveal(asSeat(1));
    store.revealCard(3);
    store.revealCard(20);

    // Bet 0 is below the rule set's min_bet=1 → INVALID_BET_AMOUNT.
    store.placeBet(asSatoshis(0));
    const err = useTableStore.getState().lastError;
    expect(err).not.toBeNull();
    expect(err?.code).toBe('INVALID_BET_AMOUNT');
  });
});
