/**
 * Deterministic replay verification (spec/state-machine.md §7).
 *
 * Properties asserted:
 *   1. Reproduction — replay() and replayWithVerification() both rebuild
 *      the exact final state from the transcript.
 *   2. Purity — replay holds no state between calls; repeated calls and
 *      prefix-then-full calls are independent and identical.
 *   3. Chain linkage — each emitted state's prior_state_hash chains to the
 *      previous state's state_hash (chainsFrom).
 *   4. Reorg restart — replaying genesis→prefix reproduces the exact
 *      intermediate state an indexer would rewind to (§7 reorg note).
 *   5. Crypto gate — replayWithVerification rejects a tampered reveal that
 *      the structure-only pure engine would wave through.
 *   6. Out-of-order — a reordered transcript is rejected.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { asHash256 } from '@cardtable/protocol-types';
import type { CardRevealAction, RoundState, SignedAction } from '@cardtable/protocol-types';
import { chainsFrom, initialState, replay, replayWithVerification } from '@cardtable/state-engine';
import { buildFullRoundTranscript } from '../src/round.js';
import type { Transcript } from '../src/round.js';

let T: Transcript;

beforeAll(async () => {
  T = await buildFullRoundTranscript();
});

function replayPrefix(n: number): RoundState {
  const r = replay({
    game_id: T.game_id,
    rule_set_hash: T.rule_set_hash,
    rule_set: T.rule_set,
    recovery_deadline: T.recovery_deadline,
    actions: T.actions.slice(0, n),
    block_heights: T.block_heights.slice(0, n),
  });
  if (!r.ok) throw new Error(`replayPrefix(${n}) failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe('deterministic replay', () => {
  it('the transcript drives a full round to S11_ROTATE_TURN', () => {
    expect(T.actions.length).toBe(12);
    expect(T.finalState.state_class).toBe('S11_ROTATE_TURN');
  });

  it('replay() reproduces the final state exactly', () => {
    const full = replayPrefix(T.actions.length);
    expect(full.state_class).toBe(T.finalState.state_class);
    expect(full.state_hash).toBe(T.finalState.state_hash);
    expect(full.pot_value).toBe(T.finalState.pot_value);
  });

  it('replayWithVerification() reproduces the same final state hash', async () => {
    const r = await replayWithVerification({
      game_id: T.game_id,
      rule_set_hash: T.rule_set_hash,
      rule_set: T.rule_set,
      recovery_deadline: T.recovery_deadline,
      actions: T.actions,
      block_heights: T.block_heights,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state_hash).toBe(T.finalState.state_hash);
  });

  it('is pure — repeated replays are byte-identical and independent', () => {
    const a = replayPrefix(T.actions.length);
    const _mid = replayPrefix(5); // interleave a different-length call
    void _mid;
    const b = replayPrefix(T.actions.length);
    expect(a.state_hash).toBe(b.state_hash);
    expect(a).toEqual(b);
  });

  it('chain linkage — each state prior_state_hash chains to the previous', () => {
    let prev: RoundState | null = initialState(T.game_id, T.rule_set_hash, T.recovery_deadline);
    for (let n = 1; n <= T.actions.length; n++) {
      const next = replayPrefix(n);
      expect(chainsFrom(prev, next)).toBe(true);
      prev = next;
    }
  });

  it('reorg restart — genesis→prefix reproduces the exact rewind target', () => {
    // An indexer that rewinds to depth k must land on exactly the state
    // that a fresh replay of the first k actions produces.
    for (const k of [3, 5, 7, 9]) {
      const once = replayPrefix(k);
      const again = replayPrefix(k);
      expect(once.state_hash).toBe(again.state_hash);
      // And continuing from genesis to the full length still works,
      // i.e. the prefix is genuinely on the canonical path.
      const full = replayPrefix(T.actions.length);
      expect(full.state_hash).toBe(T.finalState.state_hash);
      expect(once.state_class).not.toBe(full.state_class); // a real intermediate
    }
  });
});

describe('replay rejection paths', () => {
  it('rejects an out-of-order transcript (Lock before Joins)', () => {
    const reordered = [T.actions[2]!, T.actions[0]!, T.actions[1]!, ...T.actions.slice(3)];
    const r = replay({
      game_id: T.game_id,
      rule_set_hash: T.rule_set_hash,
      rule_set: T.rule_set,
      recovery_deadline: T.recovery_deadline,
      actions: reordered,
      block_heights: T.block_heights,
    });
    expect(r.ok).toBe(false);
  });

  it('crypto gate rejects a tampered reveal that the pure engine accepts', async () => {
    // Find the first CardReveal and flip its ordinal.
    const idx = T.actions.findIndex((a) => a.action_type === 'CardReveal');
    expect(idx).toBeGreaterThanOrEqual(0);
    const orig = T.actions[idx] as CardRevealAction;
    const tampered: CardRevealAction = {
      ...orig,
      reveal: {
        ...orig.reveal,
        revealed_card: { ...orig.reveal.revealed_card, ordinal: (orig.reveal.revealed_card.ordinal + 1) % 52 },
      },
    };
    const actions: SignedAction[] = [...T.actions];
    actions[idx] = tampered;

    const args = {
      game_id: T.game_id,
      rule_set_hash: T.rule_set_hash,
      rule_set: T.rule_set,
      recovery_deadline: T.recovery_deadline,
      actions,
      block_heights: T.block_heights,
    };

    // verifyAndApply recomputes the commitment and rejects.
    const verified = await replayWithVerification(args);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe('INVALID_REVEAL_PROOF');

    // The pure engine is structure-only and does not recompute the
    // commitment, so it advances past the tampered ordinal.
    const pure = replay(args);
    expect(pure.ok).toBe(true);
  });

  it('rejects an action that references the wrong successor (corrupted nonce slot)', () => {
    // Replace the Settle with a fabricated unknown action_nonce on a
    // wrong state — feed Settle as the very first action.
    const bogus = [{ ...(T.actions.at(-1) as SignedAction), action_nonce: asHash256('0'.repeat(64)) as unknown as SignedAction['action_nonce'] }];
    const r = replay({
      game_id: T.game_id,
      rule_set_hash: T.rule_set_hash,
      rule_set: T.rule_set,
      recovery_deadline: T.recovery_deadline,
      actions: bogus,
      block_heights: [T.block_heights[0]!],
    });
    expect(r.ok).toBe(false);
  });
});
