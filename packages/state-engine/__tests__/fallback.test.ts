import { describe, expect, it } from 'vitest';
import {
  asBlockHeight,
  asGameId,
  asRuleSetHash,
  asSatoshis,
} from '@cardtable/protocol-types';
import type { RuleSet } from '@cardtable/protocol-types';
import { enumerateFallbackGraph, initialState } from '../src/index.js';

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

describe('enumerateFallbackGraph', () => {
  it('emits cooperative + recovery branches at the initial state (S1)', () => {
    const rs = makeRuleSet();
    const s = initialState(asGameId('a'.repeat(64)), asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
    const fg = enumerateFallbackGraph(s, rs);

    const kinds = fg.map((b) => b.kind).sort();
    expect(kinds).toContain('cooperative');
    expect(kinds).toContain('recovery');
    expect(kinds).not.toContain('timeout'); // S1 has no timeout default

    const recovery = fg.find((b) => b.kind === 'recovery')!;
    expect(recovery.lock_time_spec.kind).toBe('absolute_height');
  });

  it('emits all three branches at S8 (the decision deadline state)', () => {
    const rs = makeRuleSet();
    const base = initialState(asGameId('a'.repeat(64)), asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
    const s = { ...base, state_class: 'S8_BET_DECISION' as const };
    const fg = enumerateFallbackGraph(s, rs);

    const kinds = new Set(fg.map((b) => b.kind));
    expect(kinds.has('cooperative')).toBe(true);
    expect(kinds.has('timeout')).toBe(true);
    expect(kinds.has('recovery')).toBe(true);

    const timeout = fg.find((b) => b.kind === 'timeout')!;
    expect(timeout.lock_time_spec.kind).toBe('relative_blocks');
    if (timeout.lock_time_spec.kind === 'relative_blocks') {
      expect(timeout.lock_time_spec.blocks).toBe(rs.decision_timeout_blocks);
    }
  });
});
