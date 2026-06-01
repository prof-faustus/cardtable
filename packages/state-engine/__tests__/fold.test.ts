/**
 * Phase 4-ext.3 — Fold action handler tests.
 *
 * Drives a synthetic S8 state with a non-null `concealed_deck` and
 * asserts:
 *   - Fold without a concealed deck (MVP path) rejects.
 *   - Fold with concealed cards transitions the player's
 *     ASSIGNED_CONCEALED cards to SURRENDERED without touching
 *     other holders' cards.
 *   - Fold with no held cards rejects.
 *   - Fold leaves card commitments / ciphertexts untouched (the
 *     spec's "no card-face leak" requirement).
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
  FoldAction,
  Outpoint,
  PlayerState,
  RoundState,
  RuleSet,
} from '@cardtable/protocol-types';
import { applyAction, initialState } from '../src/index.js';

const GAME = asGameId('a'.repeat(64));
const PUB_0 = asPubkey33('02' + '00'.repeat(32));
const PUB_1 = asPubkey33('02' + '01'.repeat(32));

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

function makePlayer(seat: number, pubkey: ReturnType<typeof asPubkey33>): PlayerState {
  return {
    seat: asSeat(seat),
    player_id: pubkey as unknown as PlayerState['player_id'],
    value_signing_pubkey: pubkey,
    participation_status: 'active',
    stake_at_risk: asSatoshis(1000),
    entropy_committed: true,
    entropy_commitment_hash: null,
    entropy_revealed: true,
    entropy_value: null,
    concealed_card_refs: [],
    default_preferences: {},
  };
}

function makeConcealedCard(
  position: number,
  holder: ReturnType<typeof asPubkey33>,
  state: ConcealedCard['lifecycle_state'],
): ConcealedCard {
  return {
    card_commitment: {
      position,
      card_commitment: asHash256(position.toString(16).padStart(64, '0')),
      card_nonce: asHash256((position + 100).toString(16).padStart(64, '0')),
    },
    ciphertext: 'cipher_' + position.toString(16),
    custody_outpoint: ('utxo_' + position.toString(16)) as unknown as Outpoint,
    holder_pubkey: holder,
    lifecycle_state: state,
  };
}

function makeS8WithConcealedDeck(): RoundState {
  const base = initialState(GAME, asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
  return {
    ...base,
    state_class: 'S8_BET_DECISION',
    acting_player_seat: asSeat(0),
    players: [makePlayer(0, PUB_0), makePlayer(1, PUB_1)],
    concealed_deck: [
      makeConcealedCard(0, PUB_0, 'ASSIGNED_CONCEALED'),
      makeConcealedCard(1, PUB_0, 'ASSIGNED_CONCEALED'),
      makeConcealedCard(2, PUB_1, 'ASSIGNED_CONCEALED'),
    ],
  };
}

function foldAction(seat: number, nonce: string): FoldAction {
  return {
    game_id: GAME,
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'Fold',
    action_nonce: asActionNonce(nonce.padStart(64, '0')),
    acting_player_seat: asSeat(seat),
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
  };
}

describe('applyFold — extended concealed-card lifecycle', () => {
  it('rejects Fold on the MVP path (concealed_deck === null)', () => {
    const rs = makeRuleSet();
    const base = initialState(GAME, asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
    const s: RoundState = {
      ...base,
      state_class: 'S8_BET_DECISION',
      acting_player_seat: asSeat(0),
      players: [makePlayer(0, PUB_0), makePlayer(1, PUB_1)],
    };
    const r = applyAction(s, foldAction(0, 'fa'), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ACTION_FOR_STATE');
  });

  it('transitions only the actor’s ASSIGNED_CONCEALED cards to SURRENDERED', () => {
    const rs = makeRuleSet();
    const s = makeS8WithConcealedDeck();
    const r = applyAction(s, foldAction(0, 'fb'), rs, asBlockHeight(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = r.value;
    expect(next.state_class).toBe('S11_ROTATE_TURN');

    // Seat 0's two cards → SURRENDERED; seat 1's card untouched.
    expect(next.concealed_deck).not.toBeNull();
    const deck = next.concealed_deck!;
    expect(deck.filter((c) => c.holder_pubkey === PUB_0).every((c) => c.lifecycle_state === 'SURRENDERED')).toBe(true);
    expect(deck.filter((c) => c.holder_pubkey === PUB_1).every((c) => c.lifecycle_state === 'ASSIGNED_CONCEALED')).toBe(true);

    // Player 0's participation_status flipped to folded.
    expect(next.players[0]?.participation_status).toBe('folded');
    expect(next.players[1]?.participation_status).toBe('active');
  });

  it('does NOT modify card_commitment / ciphertext / custody_outpoint (no face leak)', () => {
    const rs = makeRuleSet();
    const s = makeS8WithConcealedDeck();
    const r = applyAction(s, foldAction(0, 'fc'), rs, asBlockHeight(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 0; i < s.concealed_deck!.length; i++) {
      const before = s.concealed_deck![i]!;
      const after = r.value.concealed_deck![i]!;
      expect(after.card_commitment).toEqual(before.card_commitment);
      expect(after.ciphertext).toBe(before.ciphertext);
      expect(after.custody_outpoint).toBe(before.custody_outpoint);
      expect(after.holder_pubkey).toBe(before.holder_pubkey);
    }
  });

  it('rejects Fold when the actor holds no ASSIGNED_CONCEALED cards', () => {
    const rs = makeRuleSet();
    const base = makeS8WithConcealedDeck();
    // Pre-surrender all of seat 0's cards.
    const presurrendered = base.concealed_deck!.map((c) =>
      c.holder_pubkey === PUB_0 ? { ...c, lifecycle_state: 'SURRENDERED' as const } : c,
    );
    const s = { ...base, concealed_deck: presurrendered };
    const r = applyAction(s, foldAction(0, 'fd'), rs, asBlockHeight(100));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_ACTION_FOR_STATE');
  });
});
