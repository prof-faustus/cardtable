/**
 * Transaction-graph simulator.
 *
 * Models the two on-chain adversarial scenarios that the state engine
 * itself stays out of (it is pure and accepts the first valid action):
 *
 *   #11 Conflicting action transactions (double-spend) — two BetAction
 *       txs spend the same S8 state UTXO. Exactly one can win; the winner
 *       is chosen deterministically by `pickConflictWinner` per
 *       spec/ordering-rules.md §3 (confirmed-in-block > observed-by-quorum
 *       > lexicographically-smaller txid).
 *
 *   #12 Mempool eviction — a pending tx silently disappears from the
 *       mempool; the owner detects it and rebroadcasts (spec/ordering
 *       -rules.md §4). Modelled by `Mempool` + `rebroadcastIfEvicted`.
 *
 * Real BSV transactions are built with @cardtable/tx-builder so the txids
 * are genuine double-SHA-256s — the tie-break is over real bytes, not
 * fabricated strings.
 */

import { asTxId } from '@cardtable/protocol-types';
import type { TxId } from '@cardtable/protocol-types';
import { pickConflictWinner } from '@cardtable/state-engine';
import type { CandidateSnapshot } from '@cardtable/state-engine';
import { computeTxId, encodeBsvTransaction, txidHex } from '@cardtable/tx-builder';
import type { BsvTransaction } from '@cardtable/tx-builder';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`hexToBytes: odd-length hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Specification of one competing BetAction transaction. */
export interface BetCandidateSpec {
  readonly candidateId: string;
  /** The shared previous outpoint (the S8 state UTXO) — 64-hex, internal byte order. */
  readonly prevTxidHex: string;
  readonly prevVout: number;
  /** Bet amount in satoshis; distinct values yield distinct txids. */
  readonly betValueSats: number;
  /** Locking script for the bet output (defaults to a 1-byte OP_TRUE placeholder). */
  readonly lockingScriptHex?: string;
  readonly observedByQuorum?: boolean;
  readonly confirmedInBlock?: boolean;
}

export interface BuiltCandidate {
  readonly candidateId: string;
  /** Display (reversed) txid hex. */
  readonly txidHex: string;
  readonly tx: BsvTransaction;
  readonly snapshot: CandidateSnapshot;
}

/**
 * Build a real, distinct BetAction transaction spending the shared S8
 * outpoint. All candidates reference the same prev outpoint (that is what
 * makes them a double-spend); they differ in their output value, which is
 * enough to give each a distinct txid.
 */
export async function buildBetCandidate(spec: BetCandidateSpec): Promise<BuiltCandidate> {
  const lockingScript = spec.lockingScriptHex ? hexToBytes(spec.lockingScriptHex) : new Uint8Array([0x51]); // OP_TRUE
  const tx: BsvTransaction = {
    version: 1,
    inputs: [
      {
        prevTxid: hexToBytes(spec.prevTxidHex),
        prevVout: spec.prevVout,
        unlockingScript: new Uint8Array(0),
        sequence: 0xffffffff,
      },
    ],
    outputs: [{ value: BigInt(spec.betValueSats), lockingScript }],
    lockTime: 0,
  };
  const display = await txidHex(tx);
  return {
    candidateId: spec.candidateId,
    txidHex: display,
    tx,
    snapshot: {
      txid: asTxId(display),
      observed_by_quorum: spec.observedByQuorum ?? false,
      confirmed_in_block: spec.confirmedInBlock ?? false,
    },
  };
}

/**
 * Resolve a double-spend among >=2 candidates. Reduces the deterministic
 * pairwise rule over all snapshots and returns the winning candidate.
 */
export function resolveConflict(candidates: readonly BuiltCandidate[]): BuiltCandidate {
  if (candidates.length === 0) throw new Error('resolveConflict: no candidates');
  let winnerSnap = candidates[0]!.snapshot;
  for (let i = 1; i < candidates.length; i++) {
    winnerSnap = pickConflictWinner(winnerSnap, candidates[i]!.snapshot);
  }
  const winner = candidates.find((c) => c.snapshot.txid === winnerSnap.txid);
  if (winner === undefined) throw new Error('resolveConflict: winner not found (unreachable)');
  return winner;
}

/** Compare two BuiltCandidates' txids as branded TxIds (for tie-break assertions). */
export function txidLess(a: BuiltCandidate, b: BuiltCandidate): boolean {
  return (a.snapshot.txid as TxId) < (b.snapshot.txid as TxId);
}

/**
 * A minimal mempool model: a set of pending transactions keyed by display
 * txid. Eviction removes silently; `rebroadcastIfEvicted` is the owner's
 * recovery action (scenario #12).
 */
export class Mempool {
  private readonly pending = new Map<string, BsvTransaction>();

  add(c: BuiltCandidate): void {
    this.pending.set(c.txidHex, c.tx);
  }

  has(txidHex: string): boolean {
    return this.pending.has(txidHex);
  }

  /** Silent eviction (reorg/policy). Returns true if something was removed. */
  evict(txidHex: string): boolean {
    return this.pending.delete(txidHex);
  }

  list(): readonly string[] {
    return [...this.pending.keys()].sort();
  }

  size(): number {
    return this.pending.size;
  }
}

export interface RebroadcastResult {
  readonly wasEvicted: boolean;
  readonly rebroadcast: boolean;
}

/**
 * Detect eviction and rebroadcast. If the tx is no longer in the mempool,
 * re-add it (the deterministic recovery from spec/ordering-rules.md §4).
 */
export function rebroadcastIfEvicted(mp: Mempool, c: BuiltCandidate): RebroadcastResult {
  const present = mp.has(c.txidHex);
  if (present) return { wasEvicted: false, rebroadcast: false };
  mp.add(c);
  return { wasEvicted: true, rebroadcast: true };
}

/** Serialised size in bytes of a built candidate's tx (for fee/size checks). */
export function txSizeBytes(c: BuiltCandidate): number {
  return encodeBsvTransaction(c.tx).length;
}

/** Raw internal-order txid bytes (for callers that need the spend reference). */
export async function internalTxid(c: BuiltCandidate): Promise<Uint8Array> {
  return computeTxId(c.tx);
}
