/**
 * tx-simulator unit tests — double-spend resolution + mempool eviction.
 *
 * Includes a conformance check against the canonical test vector
 * spec/test-vectors/double-spend-attempt.json so the simulator's
 * ordering matches the cross-language fixture.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickConflictWinner } from '@cardtable/state-engine';
import type { CandidateSnapshot } from '@cardtable/state-engine';
import type { TxId } from '@cardtable/protocol-types';
import {
  Mempool,
  buildBetCandidate,
  rebroadcastIfEvicted,
  resolveConflict,
  txSizeBytes,
} from '../src/simulate.js';

const PREV = 'a1'.repeat(32); // 64-hex shared S8 outpoint

async function twoCandidates(opts?: {
  confirmed?: number;
  quorum?: number;
}): Promise<Awaited<ReturnType<typeof buildBetCandidate>>[]> {
  return [
    await buildBetCandidate({
      candidateId: 'A',
      prevTxidHex: PREV,
      prevVout: 0,
      betValueSats: 10,
      confirmedInBlock: opts?.confirmed === 0,
      observedByQuorum: opts?.quorum === 0,
    }),
    await buildBetCandidate({
      candidateId: 'B',
      prevTxidHex: PREV,
      prevVout: 0,
      betValueSats: 20,
      confirmedInBlock: opts?.confirmed === 1,
      observedByQuorum: opts?.quorum === 1,
    }),
  ];
}

describe('tx-simulator — double-spend', () => {
  it('both candidates spend the same outpoint (they really are a double-spend)', async () => {
    const [a, b] = await twoCandidates();
    expect(a!.tx.inputs[0]!.prevVout).toBe(b!.tx.inputs[0]!.prevVout);
    expect([...a!.tx.inputs[0]!.prevTxid]).toEqual([...b!.tx.inputs[0]!.prevTxid]);
    expect(a!.txidHex).not.toBe(b!.txidHex); // distinct txs
    expect(txSizeBytes(a!)).toBeGreaterThan(0);
  });

  it('tie-break: with no confirmation/quorum, lexicographically smaller txid wins', async () => {
    const cands = await twoCandidates();
    const winner = resolveConflict(cands);
    const sorted = [...cands].sort((x, y) => (x.txidHex < y.txidHex ? -1 : 1));
    expect(winner.txidHex).toBe(sorted[0]!.txidHex);
  });

  it('confirmed-in-block beats txid order', async () => {
    const cands = await twoCandidates({ confirmed: 1 }); // B confirmed
    expect(resolveConflict(cands).candidateId).toBe('B');
  });

  it('observed-by-quorum beats txid order when neither is confirmed', async () => {
    const cands = await twoCandidates({ quorum: 1 }); // B observed
    expect(resolveConflict(cands).candidateId).toBe('B');
  });

  it('confirmation outranks quorum', async () => {
    const cands = await twoCandidates({ confirmed: 0, quorum: 1 });
    expect(resolveConflict(cands).candidateId).toBe('A');
  });

  it('is deterministic: same specs => same winner', async () => {
    const w1 = resolveConflict(await twoCandidates());
    const w2 = resolveConflict(await twoCandidates());
    expect(w1.txidHex).toBe(w2.txidHex);
  });

  it('resolves a 3-way conflict', async () => {
    const cands = [
      await buildBetCandidate({ candidateId: 'A', prevTxidHex: PREV, prevVout: 0, betValueSats: 10 }),
      await buildBetCandidate({ candidateId: 'B', prevTxidHex: PREV, prevVout: 0, betValueSats: 20, confirmedInBlock: true }),
      await buildBetCandidate({ candidateId: 'C', prevTxidHex: PREV, prevVout: 0, betValueSats: 30 }),
    ];
    expect(resolveConflict(cands).candidateId).toBe('B');
  });
});

describe('tx-simulator — mempool eviction (#12)', () => {
  it('detects eviction and rebroadcasts', async () => {
    const cands = await twoCandidates();
    const mp = new Mempool();
    for (const c of cands) mp.add(c);
    expect(mp.size()).toBe(2);

    const victim = cands[0]!;
    expect(mp.evict(victim.txidHex)).toBe(true);
    expect(mp.has(victim.txidHex)).toBe(false);

    const rb = rebroadcastIfEvicted(mp, victim);
    expect(rb.wasEvicted).toBe(true);
    expect(rb.rebroadcast).toBe(true);
    expect(mp.has(victim.txidHex)).toBe(true);
  });

  it('no-op rebroadcast when the tx is still present', async () => {
    const [a] = await twoCandidates();
    const mp = new Mempool();
    mp.add(a!);
    const rb = rebroadcastIfEvicted(mp, a!);
    expect(rb.wasEvicted).toBe(false);
    expect(rb.rebroadcast).toBe(false);
  });
});

describe('tx-simulator — ordering conformance with spec vectors', () => {
  interface OrderingVector {
    candidate_actions: {
      candidate_id: string;
      txid_hint: string;
      observed_by_quorum: boolean;
      confirmed_in_block: boolean;
    }[];
    expected_winner_candidate_id: string;
  }

  const resolve = (vector: OrderingVector): string => {
    const toSnap = (c: OrderingVector['candidate_actions'][number]): CandidateSnapshot => ({
      // txid_hint is the vector's stand-in for the real txid used in the
      // tie-break; brand it without the 64-hex length check.
      txid: c.txid_hint as unknown as TxId,
      observed_by_quorum: c.observed_by_quorum,
      confirmed_in_block: c.confirmed_in_block,
    });
    const snaps = vector.candidate_actions.map(toSnap);
    let winnerSnap = snaps[0]!;
    for (let i = 1; i < snaps.length; i++) winnerSnap = pickConflictWinner(winnerSnap, snaps[i]!);
    return vector.candidate_actions.find((c) => (c.txid_hint as unknown as TxId) === winnerSnap.txid)!.candidate_id;
  };

  const load = (file: string): OrderingVector =>
    JSON.parse(readFileSync(new URL(`../../../spec/test-vectors/${file}`, import.meta.url), 'utf8')) as OrderingVector;

  it('double-spend-attempt.json: txid tie-break', () => {
    const v = load('double-spend-attempt.json');
    expect(resolve(v)).toBe(v.expected_winner_candidate_id);
  });

  it('timeout-canonicity.json: quorum tier outranks txid order', () => {
    const v = load('timeout-canonicity.json');
    expect(resolve(v)).toBe(v.expected_winner_candidate_id);
  });
});
