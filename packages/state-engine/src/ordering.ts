/**
 * Canonical conflict-resolution rule for two competing transactions for the
 * same state. Per `spec/ordering-rules.md` §3.
 *
 * The state engine itself is pure and accepts the first valid action passed
 * to it; this function is for the **caller** (relay / client / indexer) to
 * pick deterministically when two candidates arrive.
 */

import type { TxId } from '@cardtable/protocol-types';

/** Information available about each candidate at decision time. */
export interface CandidateSnapshot {
  readonly txid: TxId;
  readonly observed_by_quorum: boolean;
  readonly confirmed_in_block: boolean;
}

/**
 * Pick the winner of a conflict per the deterministic rule:
 *
 * 1. If exactly one is confirmed in a block, it wins.
 * 2. Otherwise, if exactly one is observed by the quorum, it wins.
 * 3. Otherwise, the lexicographically smaller txid wins.
 *
 * If both are confirmed (BSV consensus rejected one of them anyway), the
 * caller should not have reached this function; we still resolve by txid.
 */
export function pickConflictWinner(
  a: CandidateSnapshot,
  b: CandidateSnapshot,
): CandidateSnapshot {
  if (a.confirmed_in_block !== b.confirmed_in_block) {
    return a.confirmed_in_block ? a : b;
  }
  if (a.observed_by_quorum !== b.observed_by_quorum) {
    return a.observed_by_quorum ? a : b;
  }
  return a.txid < b.txid ? a : b;
}
