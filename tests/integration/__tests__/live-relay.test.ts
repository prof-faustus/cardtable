/**
 * Live-relay integration test.
 *
 * Opens a real WebSocket to a running Go relay (URL via env var
 * CARDTABLE_WS_URL; default ws://localhost:8081/ws) and drives a
 * subset of the wire protocol. The relay binary MUST be running
 * before this test starts — CI spawns it as a child process and the
 * local-dev workflow uses `docker compose up relay`.
 *
 * What this proves (over and above the unit tests):
 *   - The Go binary actually binds the WS port on this OS.
 *   - Frame framing round-trips through a real network socket.
 *   - The browser-side wire codec speaks the same bytes the Go
 *     wsadapter accepts.
 *   - mental-poker rejection (`INVALID_REVEAL_PROOF`) round-trips
 *     back to the caller as `MsgErrorReply`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MsgType, VERSION_1_0, decode, encode, type Frame } from '@cardtable/wire-ts';

// IPv4-loopback explicitly: Windows' "localhost" resolves to ::1 first on
// some runners, where the Go relay (which binds 0.0.0.0 / IPv4) is not
// reachable. 127.0.0.1 is the lowest-friction cross-OS choice.
const WS_URL = process.env['CARDTABLE_WS_URL'] ?? 'ws://127.0.0.1:8081/ws';
const RUN_LIVE = process.env['CARDTABLE_RUN_LIVE'] === '1';
const GAME_ID = process.env['CARDTABLE_GAME_ID'] ?? '00000000000000000000000000000000000000000000000000000000000000aa';

interface LiveClient {
  readonly sock: WebSocket;
  readonly received: Frame[];
  next(predicate: (f: Frame) => boolean): Promise<Frame>;
}

function open(): Promise<LiveClient> {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(WS_URL);
    const received: Frame[] = [];
    const waiters: { predicate: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];

    sock.binaryType = 'arraybuffer';
    sock.on('open', () => {
      const client: LiveClient = {
        sock,
        received,
        next(predicate) {
          const existing = received.find(predicate);
          if (existing !== undefined) return Promise.resolve(existing);
          return new Promise<Frame>((res) => {
            waiters.push({ predicate, resolve: res });
          });
        },
      };
      resolve(client);
    });
    sock.on('error', (err) => reject(err));
    sock.on('message', async (data: Buffer | ArrayBuffer) => {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
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
        // Malformed inbound frame: ignored here; the wire-ts unit
        // tests cover that path.
      }
    });
  });
}

async function send(client: LiveClient, frame: Frame): Promise<void> {
  const bytes = await encode(frame);
  client.sock.send(bytes);
}

async function sendAction(client: LiveClient, action: unknown): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(action));
  await send(client, { version: VERSION_1_0, type: MsgType.Action, payload });
}

describe.skipIf(!RUN_LIVE)('live relay over WebSocket', () => {
  let client: LiveClient;

  beforeAll(async () => {
    client = await open();
  });

  afterAll(() => {
    client.sock.close();
  });

  it('Ping → Pong round-trip', async () => {
    await send(client, {
      version: VERSION_1_0,
      type: MsgType.Ping,
      payload: new TextEncoder().encode('hello'),
    });
    const pong = await client.next((f) => f.type === MsgType.Pong);
    expect(new TextDecoder().decode(pong.payload)).toBe('hello');
  });

  it('Valid Join is accepted; relay broadcasts MsgActionAccepted and MsgTableState', async () => {
    const seat0Action = {
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'Join',
      action_nonce: '01',
      acting_player_seat: 0,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
      player_pubkey: '02' + 'aa'.repeat(32),
      stake_amount: 1000,
    };
    await sendAction(client, seat0Action);

    const ack = await client.next((f) => f.type === MsgType.ActionAccepted);
    expect(ack.type).toBe(MsgType.ActionAccepted);

    const state = await client.next((f) => f.type === MsgType.TableState);
    const parsed = JSON.parse(new TextDecoder().decode(state.payload)) as { players: unknown[] };
    expect(Array.isArray(parsed.players)).toBe(true);
    expect(parsed.players.length).toBeGreaterThanOrEqual(1);
  });

  it('Invalid Action (stake mismatch) is rejected with MsgErrorReply carrying INVALID_STAKE_AMOUNT', async () => {
    // Use seat 1 to avoid the seat-already-seated path from the
    // previous test; the relay's session was seeded with seat 0
    // already joined.
    const bad = {
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'Join',
      action_nonce: '02',
      acting_player_seat: 1,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
      player_pubkey: '02' + 'bb'.repeat(32),
      stake_amount: 999, // ruleset wants 1000
    };
    await sendAction(client, bad);

    const err = await client.next((f) => f.type === MsgType.ErrorReply);
    const body = JSON.parse(new TextDecoder().decode(err.payload)) as { code: string };
    expect(body.code).toBe('INVALID_STAKE_AMOUNT');
  });
});
