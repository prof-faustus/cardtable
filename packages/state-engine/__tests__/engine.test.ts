import { describe, it, expect } from 'vitest';
import {
  applyAction,
  classifyInBetweenRound,
  computeValueTransfer,
  computeSettlement,
  eligibility,
  getLegalActions,
  initialState,
  pickConflictWinner,
  validateTimeoutOrdering,
} from '../src/index.js';
import type {
  BetAction,
  BlockHeight,
  CardRevealAction,
  EntropyCommitAction,
  EntropyRevealAction,
  JoinAction,
  PassAction,
  RoundState,
  RuleSet,
  Satoshis,
  Seat,
  SettleAction,
  TableLockAction,
  TimeoutAction,
} from '@cardtable/protocol-types';
import {
  asActionNonce,
  asBlockHeight,
  asGameId,
  asHash256,
  asPubkey33,
  asRoundNumber,
  asRuleSetHash,
  asSatoshis,
  asSeat,
  asTxId,
  cardFromOrdinal,
} from '@cardtable/protocol-types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GAME_ID = asGameId('a'.repeat(64));
const RULE_HASH = asRuleSetHash('b'.repeat(64));
const STATE_HASH = asHash256('c'.repeat(64));
const RECOVERY_DEADLINE = asBlockHeight(244);

const PUB_0 = asPubkey33('02' + '00'.repeat(32));
const PUB_1 = asPubkey33('02' + '01'.repeat(32));
const PUB_2 = asPubkey33('02' + '02'.repeat(32));

function makeRuleSet(): RuleSet {
  return {
    game_type: 'in_between',
    player_count_min: 2,
    player_count_max: 4,
    stake_amount: asSatoshis(1000),
    min_bet: asSatoshis(1),
    max_bet: asSatoshis(100),
    decision_timeout_blocks: 6,
    recovery_timeout_blocks: 144,
    invitation_window_blocks: 18,
    default_action_by_state: { S8_BET_DECISION: 'pass' },
    penalty_schedule: {
      non_reveal: asSatoshis(100),
      bad_reveal: asSatoshis(200),
      consecutive_cards: asSatoshis(0),
      equal_cards: asSatoshis(0),
    },
    deck_format: 52,
    shuffle_algorithm_version: 1,
    settlement_rules: {
      in_between_win_multiplier: 1,
      in_between_loss_multiplier: 1,
      consecutive_cards_penalty: asSatoshis(50),
      equal_cards_penalty: asSatoshis(100),
    },
    recovery_rules: {
      refund_stakes_to_funders: true,
      apply_non_reveal_penalty: true,
      apply_bad_reveal_penalty: true,
    },
    serialisation_version: 1,
  };
}

function makeJoin(seat: Seat, stake: Satoshis = asSatoshis(1000), pubkey = PUB_0): JoinAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'Join',
    action_nonce: asActionNonce(seat.toString(16).padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    player_pubkey: pubkey,
    stake_amount: stake,
  };
}

function makeTableLock(): TableLockAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'TableLock',
    action_nonce: asActionNonce('1'.padStart(64, '0')),
    acting_player_seat: null,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
  };
}

function makeEntropyCommit(seat: Seat): EntropyCommitAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'EntropyCommit',
    action_nonce: asActionNonce(('c' + seat.toString(16)).padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    commitment_hash: asHash256('11'.repeat(32)),
  };
}

function makeEntropyReveal(seat: Seat): EntropyRevealAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'EntropyReveal',
    action_nonce: asActionNonce(('e' + seat.toString(16)).padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    entropy: asHash256('22'.repeat(32)),
  };
}

function makeCardReveal(ordinal: number): CardRevealAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'CardReveal',
    action_nonce: asActionNonce('d'.repeat(64)),
    acting_player_seat: null,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    reveal: {
      position: ordinal,
      revealed_card: cardFromOrdinal(ordinal),
      card_nonce: asHash256('33'.repeat(32)),
      deck_nonce: asHash256('44'.repeat(32)),
    },
  };
}

function makeBet(seat: Seat, amount: Satoshis): BetAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'BetAction',
    action_nonce: asActionNonce(('b' + seat.toString(16)).padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    bet_amount: amount,
  };
}

function makePass(seat: Seat): PassAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'Pass',
    // 'a' (the digit-letter "a" = 10) is hex; 'p' is not. Keep it hex.
    action_nonce: asActionNonce(('a' + seat.toString(16)).padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
  };
}

function makeSettle(seat: Seat): SettleAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'Settle',
    action_nonce: asActionNonce('5'.repeat(64)),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
  };
}

function makeTimeout(seat: Seat): TimeoutAction {
  return {
    game_id: GAME_ID,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'Timeout',
    action_nonce: asActionNonce('7'.repeat(64)),
    acting_player_seat: null,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    default_consequence: 'Pass',
    silenced_seat: seat,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initialState', () => {
  it('starts at S1_SEAT_OPEN with no players, no pot', () => {
    const s = initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
    expect(s.state_class).toBe('S1_SEAT_OPEN');
    expect(s.players).toHaveLength(0);
    expect(s.pot_value).toBe(0);
    expect(s.allowed_actions).toContain('Join');
  });
});

describe('valid-join vector', () => {
  it('accepts a Join with exact stake amount', () => {
    const rs = makeRuleSet();
    const s = initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
    const result = applyAction(s, makeJoin(asSeat(0)), rs, asBlockHeight(100));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.players).toHaveLength(1);
      expect(result.value.players[0]?.seat).toBe(0);
      expect(result.value.players[0]?.participation_status).toBe('joined');
    }
  });
});

describe('invalid-join vector', () => {
  it('rejects a Join with wrong stake amount', () => {
    const rs = makeRuleSet();
    const s = initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
    const result = applyAction(s, makeJoin(asSeat(0), asSatoshis(999)), rs, asBlockHeight(100));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_STAKE_AMOUNT');
    }
  });

  it('leaves the state unchanged after rejection', () => {
    const rs = makeRuleSet();
    const s = initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
    const result = applyAction(s, makeJoin(asSeat(0), asSatoshis(999)), rs, asBlockHeight(100));
    expect(result.ok).toBe(false);
    expect(s.players).toHaveLength(0);
  });
});

describe('timeout-refund vector', () => {
  it('S8 timeout produces S11 with unchanged pot', () => {
    const rs = makeRuleSet();
    const s: RoundState = {
      state_class: 'S8_BET_DECISION',
      game_id: GAME_ID,
      rule_set_hash: RULE_HASH,
      round_number: asRoundNumber(1),
      acting_player_seat: asSeat(0),
      players: [
        {
          seat: asSeat(0),
          player_id: PUB_0 as unknown as RoundState['players'][number]['player_id'],
          value_signing_pubkey: PUB_0,
          participation_status: 'active',
          stake_at_risk: asSatoshis(1000),
          entropy_committed: true,
          entropy_commitment_hash: null,
          entropy_revealed: true,
          entropy_value: null,
          concealed_card_refs: [],
          default_preferences: {},
        },
      ],
      pot_value: asSatoshis(2000),
      visible_cards: [cardFromOrdinal(3), cardFromOrdinal(20)],
      hidden_commitment_refs: [],
      allowed_actions: getLegalActions('S8_BET_DECISION'),
      decision_deadline_block_height: asBlockHeight(106),
      recovery_deadline_block_height: RECOVERY_DEADLINE,
      successor_template_hashes: [],
      combined_entropy: null,
      deck_commitment_hash: null,
      concealed_deck: null,
      prior_state_hash: null,
      state_hash: STATE_HASH,
    };
    const r = applyAction(s, makeTimeout(asSeat(0)), rs, asBlockHeight(107));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state_class).toBe('S11_ROTATE_TURN');
      expect(r.value.pot_value).toBe(2000); // unchanged: pass is neutral
    }
  });

  it('rejects timeout before deadline matures', () => {
    const rs = makeRuleSet();
    const s: RoundState = {
      state_class: 'S8_BET_DECISION',
      game_id: GAME_ID,
      rule_set_hash: RULE_HASH,
      round_number: asRoundNumber(1),
      acting_player_seat: asSeat(0),
      players: [],
      pot_value: asSatoshis(0),
      visible_cards: [],
      hidden_commitment_refs: [],
      allowed_actions: getLegalActions('S8_BET_DECISION'),
      decision_deadline_block_height: asBlockHeight(200),
      recovery_deadline_block_height: RECOVERY_DEADLINE,
      successor_template_hashes: [],
      combined_entropy: null,
      deck_commitment_hash: null,
      concealed_deck: null,
      prior_state_hash: null,
      state_hash: STATE_HASH,
    };
    const r = applyAction(s, makeTimeout(asSeat(0)), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TIMEOUT_NOT_MATURE');
  });
});

describe('settlement vector — classifier', () => {
  const rs = makeRuleSet();
  it('classifies WIN when third card is strictly between', () => {
    // ordinals %13: visible 3 and 7 (rank 5 and rank 9). Third must be in (3,7) strict.
    // Pick ordinal 5 (rank 7 of clubs) — strict between.
    const cards = [cardFromOrdinal(3), cardFromOrdinal(20), cardFromOrdinal(5)];
    const c = classifyInBetweenRound(cards);
    expect(c.outcome).toBe('win');
  });
  it('classifies LOSS when third card is outside (above)', () => {
    // ordinals %13: 3 and 7; third rank-ord 11 is above the high end -> loss.
    const cards = [cardFromOrdinal(3), cardFromOrdinal(20), cardFromOrdinal(11)];
    const c = classifyInBetweenRound(cards);
    expect(c.outcome).toBe('loss');
  });
  it('classifies LOSS when third card matches a visible (open interval is strict)', () => {
    // Third equals upper visible -> not strictly between -> loss.
    const cards = [cardFromOrdinal(3), cardFromOrdinal(20), cardFromOrdinal(7)];
    const c = classifyInBetweenRound(cards);
    expect(c.outcome).toBe('loss');
  });
  it('classifies CONSECUTIVE_PENALTY when visibles are consecutive', () => {
    const cards = [cardFromOrdinal(5), cardFromOrdinal(6), cardFromOrdinal(0)];
    const c = classifyInBetweenRound(cards);
    expect(c.outcome).toBe('consecutive_penalty');
  });
  it('classifies EQUAL_PENALTY when visibles have same rank', () => {
    const cards = [cardFromOrdinal(5), cardFromOrdinal(18), cardFromOrdinal(0)];
    // ordinals %13: 5, 5; equal
    const c = classifyInBetweenRound(cards);
    expect(c.outcome).toBe('equal_penalty');
  });

  it('computeValueTransfer is symmetric (sum to zero)', () => {
    const outcomes = ['win', 'loss', 'consecutive_penalty', 'equal_penalty', 'pass'] as const;
    for (const o of outcomes) {
      const { playerDelta, potDelta } = computeValueTransfer(o, asSatoshis(50), rs.settlement_rules);
      expect(playerDelta + potDelta).toBe(0);
    }
  });
});

describe('double-spend-attempt vector — ordering rule', () => {
  it('confirmed-in-block wins over unconfirmed', () => {
    const w = pickConflictWinner(
      { txid: asTxId('a'.repeat(64)), observed_by_quorum: false, confirmed_in_block: true },
      { txid: asTxId('b'.repeat(64)), observed_by_quorum: true, confirmed_in_block: false },
    );
    expect(w.txid).toBe('a'.repeat(64));
  });

  it('observed-by-quorum wins when neither confirmed', () => {
    const w = pickConflictWinner(
      { txid: asTxId('a'.repeat(64)), observed_by_quorum: false, confirmed_in_block: false },
      { txid: asTxId('b'.repeat(64)), observed_by_quorum: true, confirmed_in_block: false },
    );
    expect(w.txid).toBe('b'.repeat(64));
  });

  it('lexicographically smaller txid wins on tiebreak', () => {
    const w = pickConflictWinner(
      { txid: asTxId('a'.repeat(64)), observed_by_quorum: false, confirmed_in_block: false },
      { txid: asTxId('b'.repeat(64)), observed_by_quorum: false, confirmed_in_block: false },
    );
    expect(w.txid).toBe('a'.repeat(64));
  });
});

describe('eligibility', () => {
  const rs = makeRuleSet();
  it('all branches off before deadline', () => {
    const s: RoundState = {
      state_class: 'S8_BET_DECISION',
      game_id: GAME_ID,
      rule_set_hash: RULE_HASH,
      round_number: asRoundNumber(0),
      acting_player_seat: asSeat(0),
      players: [],
      pot_value: asSatoshis(0),
      visible_cards: [],
      hidden_commitment_refs: [],
      allowed_actions: getLegalActions('S8_BET_DECISION'),
      decision_deadline_block_height: asBlockHeight(200),
      recovery_deadline_block_height: asBlockHeight(400),
      successor_template_hashes: [],
      combined_entropy: null,
      deck_commitment_hash: null,
      concealed_deck: null,
      prior_state_hash: null,
      state_hash: STATE_HASH,
    };
    const e = eligibility(s, asBlockHeight(100));
    expect(e.canCooperate).toBe(true);
    expect(e.canTimeout).toBe(false);
    expect(e.canRecover).toBe(false);
  });

  it('timeout matures at decision deadline', () => {
    const s: RoundState = {
      state_class: 'S8_BET_DECISION',
      game_id: GAME_ID,
      rule_set_hash: RULE_HASH,
      round_number: asRoundNumber(0),
      acting_player_seat: asSeat(0),
      players: [],
      pot_value: asSatoshis(0),
      visible_cards: [],
      hidden_commitment_refs: [],
      allowed_actions: getLegalActions('S8_BET_DECISION'),
      decision_deadline_block_height: asBlockHeight(200),
      recovery_deadline_block_height: asBlockHeight(400),
      successor_template_hashes: [],
      combined_entropy: null,
      deck_commitment_hash: null,
      concealed_deck: null,
      prior_state_hash: null,
      state_hash: STATE_HASH,
    };
    const e = eligibility(s, asBlockHeight(200));
    expect(e.canTimeout).toBe(true);
    expect(e.canRecover).toBe(false);
  });
});

describe('validateTimeoutOrdering', () => {
  it('accepts decision < recovery', () => {
    expect(validateTimeoutOrdering(6, 144)).toBe(true);
  });
  it('rejects decision >= recovery', () => {
    expect(validateTimeoutOrdering(144, 6)).toBe(false);
    expect(validateTimeoutOrdering(144, 144)).toBe(false);
  });
  it('rejects zero or negative', () => {
    expect(validateTimeoutOrdering(0, 100)).toBe(false);
    expect(validateTimeoutOrdering(6, 0)).toBe(false);
  });
});

describe('end-to-end happy path through In-Between round 1', () => {
  it('initial -> 2 joins -> lock -> entropy commit×2 -> entropy reveal×2 -> deck -> two card reveals -> bet -> third card reveal -> settle', () => {
    const rs = makeRuleSet();
    let s = initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
    const h = asBlockHeight(100);

    const r1 = applyAction(s, makeJoin(asSeat(0), asSatoshis(1000), PUB_0), rs, h);
    expect(r1.ok).toBe(true);
    if (r1.ok) s = r1.value;

    const r2 = applyAction(s, makeJoin(asSeat(1), asSatoshis(1000), PUB_1), rs, h);
    expect(r2.ok).toBe(true);
    if (r2.ok) s = r2.value;

    const r3 = applyAction(s, makeTableLock(), rs, h);
    expect(r3.ok).toBe(true);
    if (r3.ok) s = r3.value;
    expect(s.state_class).toBe('S3_ENTROPY_COMMIT_WINDOW');

    s = applyAction(s, makeEntropyCommit(asSeat(0)), rs, h).value as RoundState;
    s = applyAction(s, makeEntropyCommit(asSeat(1)), rs, h).value as RoundState;
    expect(s.state_class).toBe('S4_ENTROPY_REVEAL_WINDOW');

    s = applyAction(s, makeEntropyReveal(asSeat(0)), rs, h).value as RoundState;
    s = applyAction(s, makeEntropyReveal(asSeat(1)), rs, h).value as RoundState;
    expect(s.state_class).toBe('S5_DECK_COMMITTED');

    // First and second card reveals (ordinals 3 = 5c and 20 = 9d).
    s = applyAction(s, makeCardReveal(3), rs, h).value as RoundState;
    expect(s.state_class).toBe('S6_CARD_REVEAL_FIRST');
    s = applyAction(s, makeCardReveal(20), rs, h).value as RoundState;
    expect(s.state_class).toBe('S8_BET_DECISION');
    expect(s.acting_player_seat).toBe(0);

    // Bet 50 sats.
    s = applyAction(s, makeBet(asSeat(0), asSatoshis(50)), rs, h).value as RoundState;
    expect(s.state_class).toBe('S9_CARD_REVEAL_THIRD');
    expect(s.pot_value).toBe(50);

    // Third card reveal (ordinal 7 = 9c; 9c rank 7 strictly between 5 and 9 in ordinals... let's pick 6c ord 4 wait we need rank between 5 and 9; 6=5c, 7=6c). With visibles rank 5 and rank 9 (ordinals 3 and 20 → modulo 13 → 3, 7), a winning third card has rank between 3 and 7 → ordinals modulo 13 in (3,7). pick 5 → ordinal 5 (7c).
    s = applyAction(s, makeCardReveal(5), rs, h).value as RoundState;
    expect(s.state_class).toBe('S10_SETTLED_ROUND');

    // Settle: should be a win (bet 50 → player +50, pot -50 → pot 0).
    const settlement = computeSettlement(s, rs);
    expect(settlement.ok).toBe(true);
    if (settlement.ok) {
      expect(settlement.value.outcome).toBe('win');
      expect(settlement.value.amount_won_or_lost).toBe(50);
    }

    const r10 = applyAction(s, makeSettle(asSeat(0)), rs, h);
    expect(r10.ok).toBe(true);
    if (r10.ok) {
      expect(r10.value.state_class).toBe('S11_ROTATE_TURN');
      expect(r10.value.pot_value).toBe(0);
      const seat0 = r10.value.players.find((p) => p.seat === 0);
      expect(seat0?.stake_at_risk).toBe(1050); // initial 1000 + 50 won
    }
  });

  it('pass at S8 advances to S11 with pot unchanged', () => {
    const rs = makeRuleSet();
    let s = initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
    const h = asBlockHeight(100);
    s = applyAction(s, makeJoin(asSeat(0), asSatoshis(1000), PUB_0), rs, h).value as RoundState;
    s = applyAction(s, makeJoin(asSeat(1), asSatoshis(1000), PUB_1), rs, h).value as RoundState;
    s = applyAction(s, makeTableLock(), rs, h).value as RoundState;
    s = applyAction(s, makeEntropyCommit(asSeat(0)), rs, h).value as RoundState;
    s = applyAction(s, makeEntropyCommit(asSeat(1)), rs, h).value as RoundState;
    s = applyAction(s, makeEntropyReveal(asSeat(0)), rs, h).value as RoundState;
    s = applyAction(s, makeEntropyReveal(asSeat(1)), rs, h).value as RoundState;
    s = applyAction(s, makeCardReveal(3), rs, h).value as RoundState;
    s = applyAction(s, makeCardReveal(20), rs, h).value as RoundState;

    const r = applyAction(s, makePass(asSeat(0)), rs, h);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state_class).toBe('S11_ROTATE_TURN');
      expect(r.value.pot_value).toBe(0);
    }
  });
});
