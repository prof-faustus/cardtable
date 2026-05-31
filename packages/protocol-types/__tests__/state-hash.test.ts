import { describe, expect, it } from 'vitest';
import {
  asBlockHeight,
  asGameId,
  asHash256,
  asPubkey33,
  asRoundNumber,
  asRuleSetHash,
  asSatoshis,
  asSeat,
  chainsFromHash,
  computeStateHash,
  encodeRoundState,
} from '../src/index.js';
import type { RoundState } from '../src/index.js';

function makeState(overrides: Partial<RoundState> = {}): RoundState {
  return {
    state_class: 'S1_SEAT_OPEN',
    game_id: asGameId('aa'.repeat(32)),
    rule_set_hash: asRuleSetHash('bb'.repeat(32)),
    round_number: asRoundNumber(0),
    acting_player_seat: null,
    players: [],
    pot_value: asSatoshis(0),
    visible_cards: [],
    hidden_commitment_refs: [],
    allowed_actions: ['Join', 'TableLock'],
    decision_deadline_block_height: null,
    recovery_deadline_block_height: asBlockHeight(244),
    successor_template_hashes: [],
    combined_entropy: null,
    deck_commitment_hash: null,
    prior_state_hash: null,
    state_hash: asHash256('0'.repeat(64)),
    ...overrides,
  };
}

describe('computeStateHash', () => {
  it('is deterministic — same state in, same hash out', async () => {
    const s = makeState();
    const a = await computeStateHash(s);
    const b = await computeStateHash(s);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("ignores state.state_hash itself (self-reference is zeroed inside the encoding)", async () => {
    const a = await computeStateHash(makeState({ state_hash: asHash256('00'.repeat(32)) }));
    const b = await computeStateHash(makeState({ state_hash: asHash256('ff'.repeat(32)) }));
    expect(a).toBe(b);
  });

  it('changes when any other field changes', async () => {
    const base = await computeStateHash(makeState());
    const potBump = await computeStateHash(makeState({ pot_value: asSatoshis(1) }));
    expect(potBump).not.toBe(base);
    const classBump = await computeStateHash(makeState({ state_class: 'S2_TABLE_LOCKED' }));
    expect(classBump).not.toBe(base);
    const seatBump = await computeStateHash(makeState({ acting_player_seat: asSeat(0) }));
    expect(seatBump).not.toBe(base);
    const heightBump = await computeStateHash(makeState({ recovery_deadline_block_height: asBlockHeight(500) }));
    expect(heightBump).not.toBe(base);
  });

  it('encodeRoundState produces a stable byte sequence', () => {
    const a = encodeRoundState(makeState());
    const b = encodeRoundState(makeState());
    expect(Array.from(a)).toEqual(Array.from(b));
    // Empty-state encoding contains the type tag + version + at least the
    // 32-byte zero placeholder for state_hash; reality is larger but at
    // minimum 35 bytes.
    expect(a.byteLength).toBeGreaterThan(34);
  });

  it('chainsFromHash: a child whose prior_state_hash equals computeStateHash(parent) chains; otherwise no', async () => {
    const parent = makeState();
    const parentHash = await computeStateHash(parent);
    const childOk = makeState({ prior_state_hash: parentHash, round_number: asRoundNumber(1) });
    const childBad = makeState({ prior_state_hash: asHash256('cc'.repeat(32)), round_number: asRoundNumber(1) });

    expect(await chainsFromHash(parent, childOk)).toBe(true);
    expect(await chainsFromHash(parent, childBad)).toBe(false);
  });

  it('cross-language conformance — logs the canonical state_hash for the reference S1 state', async () => {
    const s = makeState();
    const hash = await computeStateHash(s);
    // eslint-disable-next-line no-console
    console.log(`state_hash_s1_seat_open_ts=${hash}`);
    expect(hash).toHaveLength(64);
  });

  it('encodes a populated state with players + visible cards', async () => {
    const s = makeState({
      state_class: 'S8_BET_DECISION',
      acting_player_seat: asSeat(0),
      players: [
        {
          seat: asSeat(0),
          player_id: asHash256('11'.repeat(32)),
          value_signing_pubkey: asPubkey33('02' + '11'.repeat(32)),
          participation_status: 'active',
          stake_at_risk: asSatoshis(1000),
          entropy_committed: true,
          entropy_commitment_hash: asHash256('22'.repeat(32)),
          entropy_revealed: true,
          entropy_value: asHash256('33'.repeat(32)),
          concealed_card_refs: [],
          default_preferences: {},
        },
      ],
      pot_value: asSatoshis(50),
      visible_cards: [
        { rank: '5', suit: 'clubs', ordinal: 3 },
        { rank: '9', suit: 'diamonds', ordinal: 20 },
      ],
      decision_deadline_block_height: asBlockHeight(106),
    });
    const hash = await computeStateHash(s);
    expect(hash).toHaveLength(64);
    // Recompute to confirm purity.
    expect(await computeStateHash(s)).toBe(hash);
  });
});

