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
  EntropyCommitAction,
  EntropyRevealAction,
  JoinAction,
  RuleSet,
  Satoshis,
  Seat,
  TableLockAction,
} from '@cardtable/protocol-types';
import { commitEntropy, fromHex, toHex } from '@cardtable/crypto-cards';
import { initialState, verifyAndApply } from '../src/index.js';

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

const GAME_ID_HEX = '00000000000000000000000000000000000000000000000000000000000000aa';
const PLAYER_ID_HEX = '0101010101010101010101010101010101010101010101010101010101010101';
const PUBKEY_HEX = '02' + PLAYER_ID_HEX;
const ENTROPY_HEX = '0202020202020202020202020202020202020202020202020202020202020202';
const FORGED_HEX = 'ff'.repeat(32);

function makeJoin(seat: Seat, stake: Satoshis = asSatoshis(1000), pubkey = asPubkey33(PUBKEY_HEX)): JoinAction {
  return {
    game_id: asGameId(GAME_ID_HEX),
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

function makeLock(): TableLockAction {
  return {
    game_id: asGameId(GAME_ID_HEX),
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'TableLock',
    action_nonce: asActionNonce('1'.padStart(64, '0')),
    acting_player_seat: null,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
  };
}

function makeCommit(seat: Seat, commitmentHex: string, nonceHex: string): EntropyCommitAction {
  return {
    game_id: asGameId(GAME_ID_HEX),
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'EntropyCommit',
    action_nonce: asActionNonce(nonceHex.padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    commitment_hash: asHash256(commitmentHex),
  };
}

function makeReveal(seat: Seat, entropyHex: string, nonceHex: string): EntropyRevealAction {
  return {
    game_id: asGameId(GAME_ID_HEX),
    round_number: asRoundNumber(0),
    referenced_state_hash: asHash256('0'.repeat(64)),
    action_type: 'EntropyReveal',
    action_nonce: asActionNonce(nonceHex.padStart(64, '0')),
    acting_player_seat: seat,
    authorising_signature: 'sig',
    successor_state_commitment: asHash256('0'.repeat(64)),
    entropy: asHash256(entropyHex),
  };
}

describe('verifyAndApply — entropy commit/reveal mental-poker gate', () => {
  it('rejects a forged EntropyReveal that does not hash back to the prior commitment', async () => {
    const rs = makeRuleSet();
    const gameIdBytes = fromHex(GAME_ID_HEX);
    const playerIdBytes = fromHex(PLAYER_ID_HEX);
    const entropyBytes = fromHex(ENTROPY_HEX);
    const commitmentHex = toHex(await commitEntropy(entropyBytes, playerIdBytes, gameIdBytes));

    let s = initialState(asGameId(GAME_ID_HEX), asRuleSetHash('0'.repeat(64)), asBlockHeight(244));
    const h = asBlockHeight(100);

    s = unwrap(await verifyAndApply(s, makeJoin(asSeat(0)), rs, h));
    s = unwrap(await verifyAndApply(s, makeJoin(asSeat(1)), rs, h));
    s = unwrap(await verifyAndApply(s, makeLock(), rs, h));
    s = unwrap(await verifyAndApply(s, makeCommit(asSeat(0), commitmentHex, 'c0'), rs, h));
    s = unwrap(await verifyAndApply(s, makeCommit(asSeat(1), commitmentHex, 'c1'), rs, h));

    // Forged reveal — wrong entropy.
    const forged = await verifyAndApply(s, makeReveal(asSeat(0), FORGED_HEX, 'fe'), rs, h);
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe('INVALID_REVEAL_PROOF');

    // Honest reveal — same entropy that hashes to the commitment.
    const honest = await verifyAndApply(s, makeReveal(asSeat(0), ENTROPY_HEX, 'ae'), rs, h);
    expect(honest.ok).toBe(true);
  });

  it('rejects an EntropyCommit whose commitment_hash is not 64-char hex', async () => {
    const rs = makeRuleSet();
    let s = initialState(asGameId(GAME_ID_HEX), asRuleSetHash('0'.repeat(64)), asBlockHeight(244));
    const h = asBlockHeight(100);
    s = unwrap(await verifyAndApply(s, makeJoin(asSeat(0)), rs, h));
    s = unwrap(await verifyAndApply(s, makeJoin(asSeat(1)), rs, h));
    s = unwrap(await verifyAndApply(s, makeLock(), rs, h));

    // 32-char (16-byte) commitment — invalid shape.
    const badCommit = makeCommit(asSeat(0), 'a'.repeat(32), 'bad');
    const r = await verifyAndApply(s, badCommit, rs, h);
    expect(r.ok).toBe(false);
  });
});

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`unwrap: ${JSON.stringify(r.error)}`);
  return r.value;
}
