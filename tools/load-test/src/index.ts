#!/usr/bin/env node
/**
 * cardtable-load-test — concurrent-session load harness for the
 * cardtable relay.
 *
 * Opens N WebSocket connections to ws://host:port/ws in parallel,
 * sends one Join action per connection, measures the round-trip
 * latency to MsgActionAccepted, and reports:
 *
 *   - connect latency  (p50 / p95 / p99 / max)
 *   - ack     latency  (p50 / p95 / p99 / max)
 *   - errors  (count + first few messages)
 *   - throughput       (acks/sec across the whole run)
 *
 * Usage:
 *   cardtable-load-test \
 *     --ws ws://localhost:8081/ws \
 *     --game-id 00000000000000000000000000000000000000000000000000000000000000aa \
 *     --connections 100 \
 *     [--concurrency 50] [--timeout-ms 10000]
 *
 * NOTE: Each connection joins seat = its index, so the relay must
 * be configured with player_count_max >= N (default is 4 per the
 * reference rule set). Past max-seats, each subsequent action
 * yields TABLE_FULL; the harness counts those as expected errors
 * if N > max-seats.
 */

import { argv, exit, stdout, stderr } from 'node:process';
import WebSocket from 'ws';
import { MsgType, VERSION_1_0, decode, encode } from '@cardtable/wire-ts';

interface Args {
  readonly ws: string;
  readonly gameId: string;
  readonly connections: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
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
  if (!out['ws'] || !out['game-id']) {
    stderr.write('usage: cardtable-load-test --ws URL --game-id 64-HEX [--connections N] [--concurrency K] [--timeout-ms MS]\n');
    exit(2);
  }
  return {
    ws: out['ws']!,
    gameId: out['game-id']!,
    connections: parseInt(out['connections'] ?? '20', 10),
    concurrency: parseInt(out['concurrency'] ?? '20', 10),
    timeoutMs: parseInt(out['timeout-ms'] ?? '10000', 10),
  };
}

interface RunResult {
  connectMs: number | null;
  ackMs: number | null;
  error: string | null;
}

async function runOne(args: Args, seatIdx: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const result: RunResult = { connectMs: null, ackMs: null, error: null };
    const tStart = performance.now();
    let tConnected = 0;
    let settled = false;

    const sock = new WebSocket(args.ws);
    sock.binaryType = 'arraybuffer';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      result.error = `timeout after ${args.timeoutMs}ms`;
      try { sock.close(); } catch { /* ignore */ }
      resolve(result);
    }, args.timeoutMs);

    sock.on('open', async () => {
      tConnected = performance.now();
      result.connectMs = tConnected - tStart;
      const action = {
        game_id: args.gameId,
        round_number: 0,
        referenced_state_hash: '0'.repeat(64),
        action_type: 'Join',
        action_nonce: (seatIdx + 1).toString(16).padStart(64, '0'),
        acting_player_seat: seatIdx,
        authorising_signature: 'sig',
        successor_state_commitment: '0'.repeat(64),
        player_pubkey: '02' + seatIdx.toString(16).padStart(64, '0').slice(0, 64),
        stake_amount: 1000,
      };
      const payload = new TextEncoder().encode(JSON.stringify(action));
      const frame = await encode({ version: VERSION_1_0, type: MsgType.Action, payload });
      try {
        sock.send(frame);
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        result.error = `send: ${(e as Error).message}`;
        resolve(result);
      }
    });

    sock.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      result.error = err.message;
      resolve(result);
    });

    sock.on('message', async (data: Buffer | ArrayBuffer) => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      try {
        const { frame } = await decode(bytes);
        if (frame.type === MsgType.ActionAccepted) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          result.ackMs = performance.now() - tConnected;
          try { sock.close(); } catch { /* ignore */ }
          resolve(result);
        } else if (frame.type === MsgType.ErrorReply) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const body = JSON.parse(new TextDecoder().decode(frame.payload)) as { code: string };
          result.error = `relay rejected: ${body.code}`;
          try { sock.close(); } catch { /* ignore */ }
          resolve(result);
        }
      } catch {
        // ignore decode errors; the timer fires if nothing
        // meaningful arrives.
      }
    });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const args = parseArgs();
  stderr.write(`load-test: ${args.connections} connections, concurrency=${args.concurrency}, timeout=${args.timeoutMs}ms\n`);

  const t0 = performance.now();
  const results: RunResult[] = [];
  let nextSeat = 0;
  const inFlight: Promise<void>[] = [];

  while (nextSeat < args.connections) {
    while (inFlight.length < args.concurrency && nextSeat < args.connections) {
      const seat = nextSeat++;
      const p = runOne(args, seat).then((r) => {
        results.push(r);
        const idx = inFlight.indexOf(p);
        if (idx >= 0) inFlight.splice(idx, 1);
      });
      inFlight.push(p);
    }
    await Promise.race(inFlight);
  }
  await Promise.all(inFlight);

  const t1 = performance.now();
  const wallMs = t1 - t0;

  const connects = results.map((r) => r.connectMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const acks = results.map((r) => r.ackMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const errors = results.map((r) => r.error).filter((x): x is string => x !== null);

  const errorSummary: Record<string, number> = {};
  for (const e of errors) errorSummary[e] = (errorSummary[e] ?? 0) + 1;

  stdout.write(JSON.stringify({
    config: args,
    wall_ms: Math.round(wallMs),
    connects: {
      count: connects.length,
      p50_ms: Math.round(percentile(connects, 0.50)),
      p95_ms: Math.round(percentile(connects, 0.95)),
      p99_ms: Math.round(percentile(connects, 0.99)),
      max_ms: Math.round(percentile(connects, 1.0)),
    },
    acks: {
      count: acks.length,
      throughput_per_sec: Math.round((acks.length * 1000) / Math.max(wallMs, 1)),
      p50_ms: Math.round(percentile(acks, 0.50)),
      p95_ms: Math.round(percentile(acks, 0.95)),
      p99_ms: Math.round(percentile(acks, 0.99)),
      max_ms: Math.round(percentile(acks, 1.0)),
    },
    errors: {
      total: errors.length,
      by_code: errorSummary,
    },
  }, null, 2) + '\n');
}

main().catch((e) => {
  stderr.write(`fatal: ${(e as Error).message}\n`);
  exit(1);
});
