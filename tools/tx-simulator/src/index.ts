#!/usr/bin/env node
/**
 * cardtable-tx-simulator — double-spend / mempool simulator CLI.
 *
 *   cardtable-tx-simulator \
 *     --prev <64-hex> \
 *     --vout 0 \
 *     --bets 10,20            # one candidate per bet value
 *     [--confirmed 1]         # index of a candidate confirmed in a block
 *     [--quorum 0]            # index of a candidate observed by quorum
 *
 * Builds one real BetAction tx per `--bets` value spending the shared
 * `--prev:--vout` outpoint, resolves the double-spend deterministically,
 * then demonstrates a mempool eviction + rebroadcast. Prints JSON.
 */

import { argv, exit, stdout } from 'node:process';
import { Mempool, buildBetCandidate, rebroadcastIfEvicted, resolveConflict } from './simulate.js';
import type { BuiltCandidate } from './simulate.js';

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const prev = args['prev'];
  const betsArg = args['bets'];
  if (!prev || !betsArg) {
    process.stderr.write(
      'usage: cardtable-tx-simulator --prev <64-hex> --vout 0 --bets 10,20 [--confirmed N] [--quorum N]\n',
    );
    exit(2);
  }
  const vout = args['vout'] ? parseInt(args['vout'], 10) : 0;
  const bets = betsArg.split(',').map((s) => parseInt(s.trim(), 10));
  const confirmedIdx = args['confirmed'] ? parseInt(args['confirmed'], 10) : -1;
  const quorumIdx = args['quorum'] ? parseInt(args['quorum'], 10) : -1;

  const candidates: BuiltCandidate[] = [];
  for (let i = 0; i < bets.length; i++) {
    candidates.push(
      await buildBetCandidate({
        candidateId: String.fromCharCode(65 + i), // A, B, C, ...
        prevTxidHex: prev,
        prevVout: vout,
        betValueSats: bets[i]!,
        confirmedInBlock: i === confirmedIdx,
        observedByQuorum: i === quorumIdx,
      }),
    );
  }

  const winner = resolveConflict(candidates);

  // Mempool demo: load all, evict the winner, rebroadcast it.
  const mp = new Mempool();
  for (const c of candidates) mp.add(c);
  mp.evict(winner.txidHex);
  const rb = rebroadcastIfEvicted(mp, winner);

  stdout.write(
    JSON.stringify(
      {
        candidates: candidates.map((c) => ({
          id: c.candidateId,
          txid: c.txidHex,
          observed_by_quorum: c.snapshot.observed_by_quorum,
          confirmed_in_block: c.snapshot.confirmed_in_block,
        })),
        winner: { id: winner.candidateId, txid: winner.txidHex },
        mempool_after_recovery: { eviction_detected: rb.wasEvicted, rebroadcast: rb.rebroadcast, pending: mp.list() },
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  exit(1);
});
