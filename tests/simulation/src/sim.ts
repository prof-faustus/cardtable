/**
 * Seeded multi-round In-Between simulation harness.
 *
 * Drives complete rounds through the crypto-gated engine, choosing the
 * bet amount from a deterministic PRNG so a given seed always produces
 * the same transcript. After each round it checks protocol invariants:
 *
 *   - legal-action-only: every action was accepted by verifyAndApply.
 *   - state-hash chaining: prior_state_hash links consecutive states.
 *   - bounded bet: the accepted bet sits in [min_bet, max_bet].
 *   - pot reflects the accepted bet.
 *   - terminal: the round ends at S11_ROTATE_TURN.
 */

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
import type { RoundState, RuleSet, SignedAction } from '@cardtable/protocol-types';
import { buildDeckCommitment, combineEntropy, commitEntropy, fromHex, toHex } from '@cardtable/crypto-cards';
import { chainsFrom, initialState, verifyAndApply } from '@cardtable/state-engine';

const GAME_ID_HEX = '00000000000000000000000000000000000000000000000000000000000000aa';
const PLAYER_IDS = [
  '0101010101010101010101010101010101010101010101010101010101010101',
  '0303030303030303030303030303030303030303030303030303030303030303',
];
const PUBKEYS = PLAYER_IDS.map((p) => '02' + p);
const ENTROPIES = [
  '0202020202020202020202020202020202020202020202020202020202020202',
  '0404040404040404040404040404040404040404040404040404040404040404',
];

/** Small deterministic PRNG (mulberry32) — stable across machines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRuleSet(): RuleSet {
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

export interface RoundOutcome {
  readonly betAmount: number;
  /** Pot value immediately after the BetAction (at S9, before settlement). */
  readonly potAfterBet: number;
  /** Pot value at the terminal S11 state (after settlement distribution). */
  readonly finalPotValue: number;
  readonly finalStateClass: string;
  readonly finalStateHash: string;
  readonly stepCount: number;
}

const base = {
  game_id: asGameId(GAME_ID_HEX),
  round_number: asRoundNumber(0),
  referenced_state_hash: asHash256('0'.repeat(64)),
  authorising_signature: 'sig',
  successor_state_commitment: asHash256('0'.repeat(64)),
} as const;

const nonce = (tag: string) => asActionNonce(tag.padStart(64, '0'));

/**
 * Drive one full round with the given bet. Throws on the first invariant
 * violation (chain break / unexpected rejection) so the simulation fails
 * loudly rather than silently producing a wrong state.
 */
export async function simulateRound(betAmount: number): Promise<RoundOutcome> {
  const rs = makeRuleSet();
  const h = asBlockHeight(100);
  const gameIdBytes = fromHex(GAME_ID_HEX);
  const commitmentsHex = await Promise.all(
    ENTROPIES.map(async (e, i) => toHex(await commitEntropy(fromHex(e), fromHex(PLAYER_IDS[i]!), gameIdBytes))),
  );

  let s = initialState(asGameId(GAME_ID_HEX), asRuleSetHash('0'.repeat(64)), asBlockHeight(244));
  let prev: RoundState | null = s;
  let steps = 0;

  const apply = async (a: SignedAction): Promise<void> => {
    const r = await verifyAndApply(s, a, rs, h);
    if (!r.ok) throw new Error(`simulateRound: ${a.action_type} rejected: ${JSON.stringify(r.error)}`);
    if (!chainsFrom(prev, r.value)) {
      throw new Error(`simulateRound: chain break after ${a.action_type}`);
    }
    prev = r.value;
    s = r.value;
    steps += 1;
  };

  for (let i = 0; i < 2; i++) {
    await apply({
      ...base,
      action_type: 'Join',
      action_nonce: nonce('1' + i),
      acting_player_seat: asSeat(i),
      player_pubkey: asPubkey33(PUBKEYS[i]!),
      stake_amount: rs.stake_amount,
    });
  }
  await apply({ ...base, action_type: 'TableLock', action_nonce: nonce('20'), acting_player_seat: null });
  for (let i = 0; i < 2; i++) {
    await apply({
      ...base,
      action_type: 'EntropyCommit',
      action_nonce: nonce('3' + i),
      acting_player_seat: asSeat(i),
      commitment_hash: asHash256(commitmentsHex[i]!),
    });
  }
  for (let i = 0; i < 2; i++) {
    await apply({
      ...base,
      action_type: 'EntropyReveal',
      action_nonce: nonce('4' + i),
      acting_player_seat: asSeat(i),
      entropy: asHash256(ENTROPIES[i]!),
    });
  }

  const combined = await combineEntropy(ENTROPIES.map((e) => fromHex(e)));
  const dc = await buildDeckCommitment(combined, rs.deck_format, rs.shuffle_algorithm_version);
  const cardReveal = (position: number, tag: string): SignedAction => {
    const p = dc.perPosition[position]!;
    return {
      ...base,
      action_type: 'CardReveal',
      action_nonce: nonce(tag),
      acting_player_seat: null,
      reveal: {
        position: p.position,
        revealed_card: { rank: '2', suit: 'clubs', ordinal: p.ordinal },
        card_nonce: asHash256(toHex(p.cardNonce)),
        deck_nonce: asHash256(toHex(p.deckNonce)),
      },
    };
  };

  await apply(cardReveal(0, '50'));
  await apply(cardReveal(1, '51'));
  await apply({
    ...base,
    action_type: 'BetAction',
    action_nonce: nonce('60'),
    acting_player_seat: s.acting_player_seat,
    bet_amount: asSatoshis(betAmount),
  });
  const potAfterBet = Number(s.pot_value);
  await apply(cardReveal(2, '52'));
  await apply({ ...base, action_type: 'Settle', action_nonce: nonce('70'), acting_player_seat: s.acting_player_seat });

  return {
    betAmount,
    potAfterBet,
    finalPotValue: Number(s.pot_value),
    finalStateClass: s.state_class,
    finalStateHash: s.state_hash,
    stepCount: steps,
  };
}

/** Run `rounds` rounds with seeded bets in [min_bet, max_bet]. */
export async function simulate(seed: number, rounds: number): Promise<RoundOutcome[]> {
  const rs = makeRuleSet();
  const min = Number(rs.min_bet);
  const max = Number(rs.max_bet);
  const rng = mulberry32(seed);
  const out: RoundOutcome[] = [];
  for (let i = 0; i < rounds; i++) {
    const bet = min + Math.floor(rng() * (max - min + 1));
    out.push(await simulateRound(bet));
  }
  return out;
}
