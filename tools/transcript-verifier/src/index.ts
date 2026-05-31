#!/usr/bin/env node
/**
 * cardtable-transcript-verifier — Node CLI that audits a session
 * transcript end-to-end through the crypto-gated state engine.
 *
 *   cardtable-transcript-verifier \
 *     --transcript ./session.jsonl \
 *     --game-id <64-hex> \
 *     [--rule-set-hash <64-hex>] \
 *     [--recovery-height 244]
 *
 * Each line of the transcript file is one JSON-encoded SignedAction.
 * The verifier:
 *   1. Loads every action.
 *   2. Builds a default rule set (same shape as the relay's seed).
 *   3. Calls verifyAndApply on every action in order — the same gate
 *      the production relay uses. INVALID_REVEAL_PROOF / forged
 *      EntropyReveal etc. produces a clear rejection at the offending
 *      index and the verifier exits 1.
 *   4. On success, prints a JSON summary of the final state.
 */

import { readFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import {
  asBlockHeight,
  asGameId,
  asHash256,
  asRuleSetHash,
  asSatoshis,
  computeStateHash,
} from '@cardtable/protocol-types';
import type { RuleSet, SignedAction } from '@cardtable/protocol-types';
import { initialState, verifyAndApply } from '@cardtable/state-engine';

interface Args {
  readonly transcript: string;
  readonly gameId: string;
  readonly ruleSetHash: string;
  readonly recoveryHeight: number;
}

function parseArgs(): Args {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  if (!out['transcript']) {
    process.stderr.write('usage: cardtable-transcript-verifier --transcript PATH --game-id HEX [--rule-set-hash HEX] [--recovery-height N]\n');
    exit(2);
  }
  if (!out['game-id']) {
    process.stderr.write('--game-id is required\n');
    exit(2);
  }
  return {
    transcript: out['transcript']!,
    gameId: out['game-id']!,
    ruleSetHash: out['rule-set-hash'] ?? '0'.repeat(64),
    recoveryHeight: parseInt(out['recovery-height'] ?? '244', 10),
  };
}

function defaultRuleSet(): RuleSet {
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

function loadActions(path: string): readonly SignedAction[] {
  const raw = readFileSync(path, 'utf8');
  const out: SignedAction[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    out.push(JSON.parse(trimmed) as SignedAction);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const actions = loadActions(args.transcript);
  const rs = defaultRuleSet();
  const heights = actions.map(() => asBlockHeight(100));
  let state = initialState(
    asGameId(args.gameId),
    asRuleSetHash(args.ruleSetHash),
    asBlockHeight(args.recoveryHeight),
  );
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a === undefined) continue;
    const h = heights[i];
    if (h === undefined) continue;
    const r = await verifyAndApply(state, a, rs, h);
    if (!r.ok) {
      process.stderr.write(
        `REJECTED at index ${i}: ${a.action_type} -> ${r.error.code}${r.error.context ? ': ' + r.error.context : ''}\n`,
      );
      exit(1);
    }
    state = r.value;
  }

  const summary = {
    final_state_class: state.state_class,
    final_round_number: state.round_number,
    final_pot_value: state.pot_value,
    final_player_count: state.players.length,
    final_combined_entropy: state.combined_entropy,
    final_deck_commitment: state.deck_commitment_hash,
    final_state_hash: await computeStateHash(state),
    transcript_actions_count: actions.length,
  };
  // Strip the unused asHash256 import in production — it's surfaced
  // for callers who want to construct typed test fixtures.
  void asHash256;
  stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  exit(1);
});
