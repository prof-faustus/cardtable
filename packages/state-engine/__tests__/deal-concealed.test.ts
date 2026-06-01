/**
 * DealConcealed action handler tests.
 *
 * Verifies the engine:
 *   - rejects DealConcealed outside S5 (INVALID_ACTION_FOR_STATE)
 *   - rejects a second deal when concealed_deck already populated
 *   - rejects wrong card count
 *   - rejects out-of-range or duplicate positions
 *   - on success, stamps the supplied cards onto concealed_deck
 *     and stays at S5 (subsequent Fold becomes reachable)
 */

import { describe, expect, it } from 'vitest';
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
} from '@cardtable/protocol-types';
import type {
  ConcealedCard,
  DealConcealedAction,
  Outpoint,
  RoundState,
  RuleSet,
} from '@cardtable/protocol-types';
import { applyAction, initialState } from '../src/index.js';

const GAME = asGameId('a'.repeat(64));
const HOLDER = asPubkey33('02' + '11'.repeat(32));

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
      consecutive_cards: asSatoshis(50),
      equal_cards: asSatoshis(100),
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

function makeCard(position: number): ConcealedCard {
  return {
    card_commitment: {
      position,
      card_commitment: asHash256(position.toString(16).padStart(64, '0')),
      card_nonce: asHash256((position + 100).toString(16).padStart(64, '0')),
    },
    ciphertext: 'cipher_' + position.toString(16),
    custody_outpoint: ('utxo_' + position) as unknown as Outpoint,
    holder_pubkey: HOLDER,
    lifecycle_state: 'ASSIGNED_CONCEALED',
  };
}

function makeS5(): RoundState {
  const base = initialState(GAME, asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
  return { ...base, state_class: 'S5_DECK_COMMITTED', acting_player_seat: asSeat(0) };
}

function deal(cards: ConcealedCard[], nonceHex = 'd1'): DealConcealedAction {
  return {
    game_id: GAME,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'DealConcealed',
    action_nonce: asActionNonce(nonceHex.padStart(64, '0')),
    acting_player_seat: null,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    concealed_cards: cards,
  };
}

describe('applyDealConcealed', () => {
  it('rejects outside S5', () => {
    const rs = makeRuleSet();
    const base = initialState(GAME, asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
    const cards = Array.from({ length: 52 }, (_, i) => makeCard(i));
    const r = applyAction(base, deal(cards), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ACTION_FOR_STATE');
  });

  it('rejects if already dealt', () => {
    const rs = makeRuleSet();
    const s: RoundState = { ...makeS5(), concealed_deck: [makeCard(0)] };
    const cards = Array.from({ length: 52 }, (_, i) => makeCard(i));
    const r = applyAction(s, deal(cards), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects wrong card count', () => {
    const rs = makeRuleSet();
    const cards = Array.from({ length: 51 }, (_, i) => makeCard(i)); // one short
    const r = applyAction(makeS5(), deal(cards), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects out-of-range position', () => {
    const rs = makeRuleSet();
    const cards = Array.from({ length: 52 }, (_, i) => makeCard(i));
    cards[10] = makeCard(99); // 99 >= deck_format(52)
    const r = applyAction(makeS5(), deal(cards), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects duplicate positions', () => {
    const rs = makeRuleSet();
    const cards = Array.from({ length: 52 }, (_, i) => makeCard(i));
    cards[10] = makeCard(11); // dup of position 11
    const r = applyAction(makeS5(), deal(cards), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('on success: stamps the deck and stays at S5', () => {
    const rs = makeRuleSet();
    const cards = Array.from({ length: 52 }, (_, i) => makeCard(i));
    const r = applyAction(makeS5(), deal(cards), rs, asBlockHeight(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state_class).toBe('S5_DECK_COMMITTED');
    expect(r.value.concealed_deck).not.toBeNull();
    expect(r.value.concealed_deck!.length).toBe(52);
    expect(r.value.concealed_deck![0]?.card_commitment.position).toBe(0);
    expect(r.value.concealed_deck![51]?.card_commitment.position).toBe(51);
  });
});
