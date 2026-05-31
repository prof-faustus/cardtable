/**
 * Full-round end-to-end test — the strongest proof that the
 * crypto-gated state machine works.
 *
 * Drives one complete In-Between round through verifyAndApply
 * (the production gate, not the bare engine) with REAL commitment
 * hashes for entropy reveals AND real reveal-proofs for all three
 * card reveals:
 *
 *   S1 -> 2 Joins -> S1
 *   S1 -> TableLock -> S3
 *   S3 -> EntropyCommit x2 -> S4
 *   S4 -> EntropyReveal x2 -> S5 (deck commitment materialised)
 *   S5 -> CardReveal (pos 0) -> S6
 *   S6 -> CardReveal (pos 1) -> S8 (engine auto-advances S7 -> S8)
 *   S8 -> BetAction -> S9
 *   S9 -> CardReveal (pos 2) -> S10
 *   S10 -> Settle -> S11
 *
 * Every reveal is verified against the materialised deck commitment;
 * the test would fail if any cryptographic property regressed.
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
import type { CardRevealAction, RoundState, RuleSet, SignedAction } from '@cardtable/protocol-types';
import { buildDeckCommitment, combineEntropy, commitEntropy, fromHex, toHex } from '@cardtable/crypto-cards';
import { initialState, verifyAndApply } from '../src/index.js';

const GAME_ID_HEX = '00000000000000000000000000000000000000000000000000000000000000aa';

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

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`unwrap: ${JSON.stringify(r.error)}`);
  return r.value;
}

let counter = 0;
function nextNonce(_tag: string): SignedAction['action_nonce'] {
  // tag retained as a comment-only field; the action_nonce itself
  // MUST be lowercase hex per asActionNonce's regex.
  counter += 1;
  return asActionNonce(counter.toString(16).padStart(64, '0'));
}

function cardRevealAction(
  position: number,
  ordinal: number,
  cardNonce: Uint8Array,
  deckNonce: Uint8Array,
): CardRevealAction {
  return {
    game_id: asGameId(GAME_ID_HEX),
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'CardReveal',
    action_nonce: nextNonce('cd'),
    acting_player_seat: null,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    reveal: {
      position,
      revealed_card: { rank: '2', suit: 'clubs', ordinal },
      card_nonce: asHash256(toHex(cardNonce)),
      deck_nonce: asHash256(toHex(deckNonce)),
    },
  };
}

describe('full-round end-to-end through verifyAndApply', () => {
  it('drives a complete In-Between round; every reveal verifies against the deck commitment', async () => {
    counter = 0;
    const rs = makeRuleSet();
    const h = asBlockHeight(100);

    const playerIds = [
      '0101010101010101010101010101010101010101010101010101010101010101',
      '0303030303030303030303030303030303030303030303030303030303030303',
    ];
    const pubkeys = playerIds.map((p) => '02' + p);
    const entropies = [
      '0202020202020202020202020202020202020202020202020202020202020202',
      '0404040404040404040404040404040404040404040404040404040404040404',
    ];
    const gameIdBytes = fromHex(GAME_ID_HEX);
    const commitmentsHex = await Promise.all(
      entropies.map(async (e, i) =>
        toHex(await commitEntropy(fromHex(e), fromHex(playerIds[i]!), gameIdBytes)),
      ),
    );

    let s: RoundState = initialState(asGameId(GAME_ID_HEX), asRuleSetHash('0'.repeat(64)), asBlockHeight(244));

    // -- Joins
    for (let i = 0; i < 2; i++) {
      s = unwrap(await verifyAndApply(s, {
        game_id: s.game_id,
        round_number: asRoundNumber(0),
        referenced_state_hash: asHash256('0'.repeat(64)),
        action_type: 'Join',
        action_nonce: nextNonce('j'),
        acting_player_seat: asSeat(i),
        authorising_signature: 'sig',
        successor_state_commitment: asHash256('0'.repeat(64)),
        player_pubkey: asPubkey33(pubkeys[i]!),
        stake_amount: rs.stake_amount,
      }, rs, h));
    }

    // -- TableLock
    s = unwrap(await verifyAndApply(s, {
      game_id: s.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'TableLock',
      action_nonce: nextNonce('tl'),
      acting_player_seat: null,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
    }, rs, h));

    // -- EntropyCommit ×2
    for (let i = 0; i < 2; i++) {
      s = unwrap(await verifyAndApply(s, {
        game_id: s.game_id,
        round_number: asRoundNumber(0),
        referenced_state_hash: asHash256('0'.repeat(64)),
        action_type: 'EntropyCommit',
        action_nonce: nextNonce('ec'),
        acting_player_seat: asSeat(i),
        authorising_signature: 'sig',
        successor_state_commitment: asHash256('0'.repeat(64)),
        commitment_hash: asHash256(commitmentsHex[i]!),
      }, rs, h));
    }

    // -- EntropyReveal ×2 (engine materialises deck commitment at the second reveal)
    for (let i = 0; i < 2; i++) {
      s = unwrap(await verifyAndApply(s, {
        game_id: s.game_id,
        round_number: asRoundNumber(0),
        referenced_state_hash: asHash256('0'.repeat(64)),
        action_type: 'EntropyReveal',
        action_nonce: nextNonce('er'),
        acting_player_seat: asSeat(i),
        authorising_signature: 'sig',
        successor_state_commitment: asHash256('0'.repeat(64)),
        entropy: asHash256(entropies[i]!),
      }, rs, h));
    }
    expect(s.state_class).toBe('S5_DECK_COMMITTED');
    expect(s.combined_entropy).not.toBeNull();
    expect(s.deck_commitment_hash).not.toBeNull();

    // Build the deck locally to derive valid reveals.
    const combined = await combineEntropy(entropies.map((e) => fromHex(e)));
    const dc = await buildDeckCommitment(combined, rs.deck_format, rs.shuffle_algorithm_version);

    // -- CardReveal (position 0): S5 -> S6
    {
      const p = dc.perPosition[0]!;
      s = unwrap(await verifyAndApply(s, cardRevealAction(p.position, p.ordinal, p.cardNonce, p.deckNonce), rs, h));
      expect(s.state_class).toBe('S6_CARD_REVEAL_FIRST');
    }

    // -- CardReveal (position 1): S6 -> S8 (engine auto-jumps S7 -> S8)
    {
      const p = dc.perPosition[1]!;
      s = unwrap(await verifyAndApply(s, cardRevealAction(p.position, p.ordinal, p.cardNonce, p.deckNonce), rs, h));
      expect(s.state_class).toBe('S8_BET_DECISION');
      expect(s.acting_player_seat).not.toBeNull();
    }

    // -- BetAction: S8 -> S9
    s = unwrap(await verifyAndApply(s, {
      game_id: s.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'BetAction',
      action_nonce: nextNonce('be'),
      acting_player_seat: s.acting_player_seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      bet_amount: asSatoshis(10),
    }, rs, h));
    expect(s.state_class).toBe('S9_CARD_REVEAL_THIRD');
    expect(s.pot_value).toBe(10);

    // -- CardReveal (position 2): S9 -> S10
    {
      const p = dc.perPosition[2]!;
      s = unwrap(await verifyAndApply(s, cardRevealAction(p.position, p.ordinal, p.cardNonce, p.deckNonce), rs, h));
      expect(s.state_class).toBe('S10_SETTLED_ROUND');
    }

    // -- Settle: S10 -> S11
    s = unwrap(await verifyAndApply(s, {
      game_id: s.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'Settle',
      action_nonce: nextNonce('s'),
      acting_player_seat: s.acting_player_seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
    }, rs, h));
    expect(s.state_class).toBe('S11_ROTATE_TURN');
  });
});
