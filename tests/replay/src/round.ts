/**
 * Build a complete, cryptographically-valid In-Between transcript.
 *
 * We drive the round through `verifyAndApply` (the production crypto
 * gate) step by step, capturing each accepted SignedAction together with
 * the block height it was evaluated at. Because every step is verified as
 * it is built, the resulting transcript is guaranteed replayable by both
 * the pure engine (`replay`) and the crypto gate (`replayWithVerification`).
 *
 * Canonical sequence (2 players):
 *   Join×2 → Lock → Commit×2 → Reveal×2 (→S5) → CardReveal p0 (→S6)
 *   → CardReveal p1 (→S8) → Bet (→S9) → CardReveal p2 (→S10) → Settle (→S11)
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
import type {
  BlockHeight,
  GameId,
  RoundState,
  RuleSet,
  RuleSetHash,
  SignedAction,
} from '@cardtable/protocol-types';
import { buildDeckCommitment, combineEntropy, commitEntropy, fromHex, toHex } from '@cardtable/crypto-cards';
import { verifyAndApply, initialState } from '@cardtable/state-engine';

export const GAME_ID_HEX = '00000000000000000000000000000000000000000000000000000000000000aa';
export const RULE_SET_HASH_HEX = '0'.repeat(64);
export const RECOVERY_HEIGHT = 244;
export const ROUND_HEIGHT = 100;

export const PLAYER_IDS = [
  '0101010101010101010101010101010101010101010101010101010101010101',
  '0303030303030303030303030303030303030303030303030303030303030303',
];
export const PUBKEYS = PLAYER_IDS.map((p) => '02' + p);
export const ENTROPIES = [
  '0202020202020202020202020202020202020202020202020202020202020202',
  '0404040404040404040404040404040404040404040404040404040404040404',
];

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

export interface Transcript {
  readonly game_id: GameId;
  readonly rule_set_hash: RuleSetHash;
  readonly rule_set: RuleSet;
  readonly recovery_deadline: BlockHeight;
  readonly actions: readonly SignedAction[];
  readonly block_heights: readonly BlockHeight[];
  readonly finalState: RoundState;
}

const base = {
  game_id: asGameId(GAME_ID_HEX),
  round_number: asRoundNumber(0),
  referenced_state_hash: asHash256('0'.repeat(64)),
  authorising_signature: 'sig',
  successor_state_commitment: asHash256('0'.repeat(64)),
} as const;

function nonce(tag: string): ReturnType<typeof asActionNonce> {
  return asActionNonce(tag.padStart(64, '0'));
}

/**
 * Assert a state class without narrowing the caller's `state` variable.
 * The round driver reassigns `s` through a closure, so an inline
 * `if (s.state_class !== 'X')` would leave TS with a stale narrowed type.
 */
function assertClass(state: RoundState, want: string): void {
  if ((state.state_class as string) !== want) {
    throw new Error(`expected ${want}, got ${state.state_class}`);
  }
}

/** Build and verify the full canonical round, capturing the transcript. */
export async function buildFullRoundTranscript(): Promise<Transcript> {
  const rs = makeRuleSet();
  const h = asBlockHeight(ROUND_HEIGHT);
  const gameIdBytes = fromHex(GAME_ID_HEX);
  const commitmentsHex = await Promise.all(
    ENTROPIES.map(async (e, i) => toHex(await commitEntropy(fromHex(e), fromHex(PLAYER_IDS[i]!), gameIdBytes))),
  );

  const actions: SignedAction[] = [];
  let s = initialState(asGameId(GAME_ID_HEX), asRuleSetHash(RULE_SET_HASH_HEX), asBlockHeight(RECOVERY_HEIGHT));

  const apply = async (a: SignedAction): Promise<void> => {
    const r = await verifyAndApply(s, a, rs, h);
    if (!r.ok) throw new Error(`buildFullRoundTranscript: ${a.action_type} rejected: ${JSON.stringify(r.error)}`);
    s = r.value;
    actions.push(a);
  };

  // Joins
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
  // Lock
  await apply({ ...base, action_type: 'TableLock', action_nonce: nonce('20'), acting_player_seat: null });
  // Commits
  for (let i = 0; i < 2; i++) {
    await apply({
      ...base,
      action_type: 'EntropyCommit',
      action_nonce: nonce('3' + i),
      acting_player_seat: asSeat(i),
      commitment_hash: asHash256(commitmentsHex[i]!),
    });
  }
  // Reveals → S5
  for (let i = 0; i < 2; i++) {
    await apply({
      ...base,
      action_type: 'EntropyReveal',
      action_nonce: nonce('4' + i),
      acting_player_seat: asSeat(i),
      entropy: asHash256(ENTROPIES[i]!),
    });
  }
  assertClass(s, 'S5_DECK_COMMITTED');

  // Deck commitment → reveal proofs.
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

  await apply(cardReveal(0, '50')); // → S6
  await apply(cardReveal(1, '51')); // → S8
  assertClass(s, 'S8_BET_DECISION');
  const betSeat = s.acting_player_seat;
  await apply({
    ...base,
    action_type: 'BetAction',
    action_nonce: nonce('60'),
    acting_player_seat: betSeat,
    bet_amount: asSatoshis(10),
  });
  await apply(cardReveal(2, '52')); // → S10
  const settleSeat = s.acting_player_seat;
  await apply({ ...base, action_type: 'Settle', action_nonce: nonce('70'), acting_player_seat: settleSeat });

  return {
    game_id: asGameId(GAME_ID_HEX),
    rule_set_hash: asRuleSetHash(RULE_SET_HASH_HEX),
    rule_set: rs,
    recovery_deadline: asBlockHeight(RECOVERY_HEIGHT),
    actions,
    block_heights: actions.map(() => asBlockHeight(ROUND_HEIGHT)),
    finalState: s,
  };
}
