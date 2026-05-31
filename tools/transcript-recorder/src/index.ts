#!/usr/bin/env node
/**
 * cardtable-transcript-recorder — drive a full In-Between round
 * against a live relay and emit a JSONL transcript suitable for
 * regression replay through the indexer or the TS verifier.
 *
 * Usage:
 *   cardtable-transcript-recorder \
 *     --ws ws://localhost:8081/ws \
 *     --game-id 00...aa \
 *     --out ./session.jsonl
 *
 * Drives the same Join × 2 → Lock → Commit × 2 → Reveal × 2 →
 * CardReveal × 3 + Bet → Settle sequence as the live full-round
 * integration test. Every accepted action is appended to `out`
 * as one JSON line; the file is overwritten if it exists.
 *
 * Exit codes:
 *   0  — full round completed; transcript written
 *   1  — relay rejected an action (rejection logged to stderr)
 *   2  — bad arguments
 */

import { writeFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import WebSocket from 'ws';
import {
  buildDeckCommitment,
  combineEntropy,
  commitEntropy,
  fromHex,
  toHex,
} from '@cardtable/crypto-cards';
import { MsgType, VERSION_1_0, decode, encode, type Frame } from '@cardtable/wire-ts';

interface Args {
  readonly ws: string;
  readonly gameId: string;
  readonly out: string;
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
  if (!out['ws'] || !out['game-id'] || !out['out']) {
    stderr.write('usage: cardtable-transcript-recorder --ws URL --game-id 64-HEX --out PATH\n');
    exit(2);
  }
  return { ws: out['ws']!, gameId: out['game-id']!, out: out['out']! };
}

interface LiveClient {
  readonly sock: WebSocket;
  readonly received: Frame[];
  next(predicate: (f: Frame) => boolean): Promise<Frame>;
}

function open(url: string): Promise<LiveClient> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    const received: Frame[] = [];
    const waiters: { predicate: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
    sock.binaryType = 'arraybuffer';
    sock.on('open', () =>
      resolve({
        sock,
        received,
        next(predicate) {
          const existing = received.find(predicate);
          if (existing !== undefined) return Promise.resolve(existing);
          return new Promise<Frame>((res) => waiters.push({ predicate, resolve: res }));
        },
      }),
    );
    sock.on('error', reject);
    sock.on('message', async (data: Buffer | ArrayBuffer) => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      try {
        const { frame } = await decode(bytes);
        received.push(frame);
        for (let i = waiters.length - 1; i >= 0; i--) {
          const w = waiters[i]!;
          if (w.predicate(frame)) {
            w.resolve(frame);
            waiters.splice(i, 1);
          }
        }
      } catch {
        // wire-ts unit tests cover the malformed branch
      }
    });
  });
}

async function sendAction(client: LiveClient, action: unknown): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(action));
  client.sock.send(await encode({ version: VERSION_1_0, type: MsgType.Action, payload }));
}

const PLAYER_IDS = [
  '0101010101010101010101010101010101010101010101010101010101010101',
  '0303030303030303030303030303030303030303030303030303030303030303',
];
const PUBKEYS = PLAYER_IDS.map((p) => '02' + p);
const ENTROPIES = [
  '0202020202020202020202020202020202020202020202020202020202020202',
  '0404040404040404040404040404040404040404040404040404040404040404',
];

let nonceCounter = 0;
function nextNonce(): string {
  nonceCounter += 1;
  return nonceCounter.toString(16).padStart(64, '0');
}

async function main(): Promise<void> {
  const args = parseArgs();
  const gameIdBytes = fromHex(args.gameId);
  const commitments = await Promise.all(
    ENTROPIES.map(async (e, i) =>
      toHex(await commitEntropy(fromHex(e), fromHex(PLAYER_IDS[i]!), gameIdBytes)),
    ),
  );
  const combined = await combineEntropy(ENTROPIES.map((e) => fromHex(e)));
  const dc = await buildDeckCommitment(combined, 52, 1);

  const client = await open(args.ws);
  const transcript: unknown[] = [];
  let cursor = -1;

  const awaitOk = async (label: string): Promise<void> => {
    const frame = await client.next((f) => {
      const idx = client.received.indexOf(f);
      return idx > cursor && (f.type === MsgType.TableState || f.type === MsgType.ErrorReply);
    });
    cursor = client.received.indexOf(frame);
    if (frame.type === MsgType.ErrorReply) {
      const body = JSON.parse(new TextDecoder().decode(frame.payload)) as { code: string; context: string };
      stderr.write(`REJECTED ${label}: ${body.code} — ${body.context}\n`);
      exit(1);
    }
  };

  const submit = async (label: string, action: Record<string, unknown>): Promise<void> => {
    transcript.push(action);
    await sendAction(client, action);
    await awaitOk(label);
  };

  const base = {
    game_id: args.gameId,
    round_number: 0,
    referenced_state_hash: '0'.repeat(64),
    authorising_signature: 'sig',
    successor_state_commitment: '0'.repeat(64),
  };

  await submit('Join seat 0', { ...base, action_type: 'Join', action_nonce: nextNonce(), acting_player_seat: 0, player_pubkey: PUBKEYS[0], stake_amount: 1000 });
  await submit('Join seat 1', { ...base, action_type: 'Join', action_nonce: nextNonce(), acting_player_seat: 1, player_pubkey: PUBKEYS[1], stake_amount: 1000 });
  await submit('TableLock', { ...base, action_type: 'TableLock', action_nonce: nextNonce(), acting_player_seat: null });
  for (let i = 0; i < 2; i++) {
    await submit(`EntropyCommit seat ${i}`, { ...base, action_type: 'EntropyCommit', action_nonce: nextNonce(), acting_player_seat: i, commitment_hash: commitments[i] });
  }
  for (let i = 0; i < 2; i++) {
    await submit(`EntropyReveal seat ${i}`, { ...base, action_type: 'EntropyReveal', action_nonce: nextNonce(), acting_player_seat: i, entropy: ENTROPIES[i] });
  }
  for (let pos = 0; pos < 2; pos++) {
    const p = dc.perPosition[pos]!;
    await submit(`CardReveal pos ${pos}`, {
      ...base,
      action_type: 'CardReveal',
      action_nonce: nextNonce(),
      acting_player_seat: null,
      reveal: { position: p.position, revealed_card: { rank: '2', suit: 'clubs', ordinal: p.ordinal }, card_nonce: toHex(p.cardNonce), deck_nonce: toHex(p.deckNonce) },
    });
  }
  await submit('BetAction', { ...base, action_type: 'BetAction', action_nonce: nextNonce(), acting_player_seat: 0, bet_amount: 10 });
  {
    const p = dc.perPosition[2]!;
    await submit('CardReveal pos 2', {
      ...base,
      action_type: 'CardReveal',
      action_nonce: nextNonce(),
      acting_player_seat: null,
      reveal: { position: p.position, revealed_card: { rank: '2', suit: 'clubs', ordinal: p.ordinal }, card_nonce: toHex(p.cardNonce), deck_nonce: toHex(p.deckNonce) },
    });
  }
  await submit('Settle', { ...base, action_type: 'Settle', action_nonce: nextNonce(), acting_player_seat: 0 });

  client.sock.close();
  writeFileSync(args.out, transcript.map((a) => JSON.stringify(a)).join('\n') + '\n', 'utf8');
  stdout.write(`wrote ${transcript.length} actions to ${args.out}\n`);
}

main().catch((e) => {
  stderr.write(`fatal: ${(e as Error).message}\n`);
  exit(1);
});
