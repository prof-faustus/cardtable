import { describe, expect, it } from 'vitest';
import {
  asBlockHeight,
  asGameId,
  asHash256,
  asPubkey33,
  asRuleSetHash,
  asSatoshis,
} from '@cardtable/protocol-types';
import type { RuleSet } from '@cardtable/protocol-types';
import {
  enumerateFallbackGraph,
  initialState,
  materialiseFallbackGraph,
} from '../src/index.js';

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

describe('materialiseFallbackGraph', () => {
  it('produces BSV locking scripts for the timeout and recovery branches at S8', () => {
    const rs = makeRuleSet();
    const base = initialState(asGameId('a'.repeat(64)), asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
    const s = { ...base, state_class: 'S8_BET_DECISION' as const };

    const branches = enumerateFallbackGraph(s, rs);
    const built = materialiseFallbackGraph(branches, {
      decision_timeout_blocks: rs.decision_timeout_blocks,
      recovery_height: asBlockHeight(244),
      timeout_authorisers: [asPubkey33('02' + '11'.repeat(32)), asPubkey33('02' + '22'.repeat(32))],
      timeout_template_hash: asHash256('cc'.repeat(32)),
      recovery_signer: asPubkey33('02' + '33'.repeat(32)),
    });

    const byKind = new Map(built.map((b) => [b.branch.kind, b]));
    const timeout = byKind.get('timeout');
    const recovery = byKind.get('recovery');
    const cooperative = byKind.get('cooperative');

    expect(timeout).toBeDefined();
    expect(timeout?.locking_script).toBeInstanceOf(Uint8Array);
    expect(timeout?.locking_script?.byteLength).toBeGreaterThan(0);
    expect(timeout?.locktime.kind).toBe('relative_blocks');

    expect(recovery).toBeDefined();
    expect(recovery?.locking_script).toBeInstanceOf(Uint8Array);
    expect(recovery?.locking_script?.byteLength).toBeGreaterThan(0);
    expect(recovery?.locktime.kind).toBe('absolute_height');

    expect(cooperative).toBeDefined();
    expect(cooperative?.locking_script).toBeNull();
    expect(cooperative?.locktime).toBeNull();
  });
});
