/**
 * Lifecycle extensibility test.
 *
 * Custom (non-canonical) `CardLifecycleState` values MUST be:
 *   - accepted at runtime (the type union permits arbitrary strings);
 *   - left untouched by `applyFold` (the handler only acts on the
 *     canonical `ASSIGNED_CONCEALED`).
 *
 * Together these properties let a poker variant extend the
 * lifecycle without engine changes — e.g. add `MUCKED` for the
 * dead-hand pile.
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
  CANONICAL_LIFECYCLE_STATES,
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

function rs(): RuleSet {
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

function player(seat: number): PlayerState {
  return {
    seat: asSeat(seat),
    player_id: PUB_0 as unknown as PlayerState['player_id'],
    value_signing_pubkey: PUB_0,
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

function card(position: number, state: ConcealedCard['lifecycle_state']): ConcealedCard {
  return {
    card_commitment: {
      position,
      card_commitment: asHash256(position.toString(16).padStart(64, '0')),
      card_nonce: asHash256((position + 100).toString(16).padStart(64, '0')),
    },
    ciphertext: 'cipher_' + position,
    custody_outpoint: ('utxo_' + position) as unknown as Outpoint,
    holder_pubkey: PUB_0,
    lifecycle_state: state,
  };
}

describe('lifecycle extensibility — variant-specific states', () => {
  it('CANONICAL_LIFECYCLE_STATES enumerates the five reference states', () => {
    expect(CANONICAL_LIFECYCLE_STATES).toEqual([
      'UNDEALT',
      'ASSIGNED_CONCEALED',
      'REVEALED',
      'SURRENDERED',
      'RETIRED',
    ]);
  });

  it('accepts a non-canonical state string on a ConcealedCard without crash', () => {
    // The type union permits arbitrary strings; the engine treats
    // unknown states as opaque, so they pass through.
    const variant: ConcealedCard = card(0, 'MUCKED' as ConcealedCard['lifecycle_state']);
    expect(variant.lifecycle_state).toBe('MUCKED');
  });

  it('Fold leaves variant-specific states untouched and only transitions ASSIGNED_CONCEALED', () => {
    const base = initialState(GAME, asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
    const s: RoundState = {
      ...base,
      state_class: 'S8_BET_DECISION',
      acting_player_seat: asSeat(0),
      players: [player(0)],
      concealed_deck: [
        card(0, 'ASSIGNED_CONCEALED'),
        card(1, 'MUCKED' as ConcealedCard['lifecycle_state']),
        card(2, 'BURNT' as ConcealedCard['lifecycle_state']),
      ],
    };
    const fold: FoldAction = {
      game_id: GAME,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'Fold',
      action_nonce: asActionNonce('e0'.padStart(64, '0')),
      acting_player_seat: asSeat(0),
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
    };
    const r = applyAction(s, fold, rs(), asBlockHeight(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const deck = r.value.concealed_deck!;
    expect(deck[0]?.lifecycle_state).toBe('SURRENDERED'); // canonical → transitioned
    expect(deck[1]?.lifecycle_state).toBe('MUCKED');       // variant → passed through
    expect(deck[2]?.lifecycle_state).toBe('BURNT');        // variant → passed through
  });
});
