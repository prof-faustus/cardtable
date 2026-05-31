/**
 * Full mental-poker round against the live Go relay.
 *
 * Drives Join × 2 → Lock → EntropyCommit × 2 → EntropyReveal × 2 →
 * CardReveal × 3 + Bet → Settle through a real WebSocket. Every
 * commit hash is computed by @cardtable/crypto-cards.commitEntropy
 * (the same function the relay's session.verifyCrypto consults),
 * and every reveal proof comes from the locally-rebuilt deck
 * commitment.
 *
 * This is the strongest cross-system proof we can run: if the
 * cardtable mental-poker stack works end-to-end across the
 * network, this passes.
 *
 * Skip gates:
 *   - CARDTABLE_RUN_LIVE=1 (the live-relay smoke suite uses the same)
 *   - CARDTABLE_RUN_FULL_ROUND=1 (this suite specifically)
 *
 * The CI driver launches a fresh relay before this test so the
 * session is at S1_SEAT_OPEN with no prior actions.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  buildDeckCommitment,
  combineEntropy,
  commitEntropy,
  fromHex,
  toHex,
} from '@cardtable/crypto-cards';
import { MsgType, VERSION_1_0, decode, encode, type Frame } from '@cardtable/wire-ts';

const WS_URL = process.env['CARDTABLE_WS_URL'] ?? 'ws://127.0.0.1:8081/ws';
const RUN_LIVE = process.env['CARDTABLE_RUN_LIVE'] === '1';
const RUN_FULL = process.env['CARDTABLE_RUN_FULL_ROUND'] === '1';
const GAME_ID = process.env['CARDTABLE_GAME_ID'] ?? '00000000000000000000000000000000000000000000000000000000000000aa';

const PLAYER_IDS = [
  '0101010101010101010101010101010101010101010101010101010101010101',
  '0303030303030303030303030303030303030303030303030303030303030303',
];
const PUBKEYS = PLAYER_IDS.map((p) => '02' + p);
const ENTROPIES = [
  '0202020202020202020202020202020202020202020202020202020202020202',
  '0404040404040404040404040404040404040404040404040404040404040404',
];

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
    sock.on('error', (err) => reject(err));
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
        // ignored — wire-ts unit tests cover the malformed branch
      }
    });
  });
}

async function send(client: LiveClient, frame: Frame): Promise<void> {
  client.sock.send(await encode(frame));
}

async function sendAction(client: LiveClient, action: unknown): Promise<void> {
  const payload = new TextEncoder().encode(JSON.stringify(action));
  await send(client, { version: VERSION_1_0, type: MsgType.Action, payload });
}

interface ParsedTableState {
  readonly state_class: string;
  readonly players: { seat: number; stake_at_risk: number }[];
  readonly pot_value: number;
  readonly combined_entropy: string | null;
  readonly deck_commitment_hash: string | null;
  readonly acting_player_seat: number | null;
  readonly visible_cards: { ordinal: number }[];
}

let nonceCounter = 0;
function nextNonce(): string {
  nonceCounter += 1;
  return nonceCounter.toString(16).padStart(64, '0');
}

describe.skipIf(!RUN_LIVE || !RUN_FULL)('full mental-poker round against the live relay', () => {
  let client: LiveClient;

  beforeAll(async () => {
    client = await open();
  });
  afterAll(() => {
    client.sock.close();
  });

  it('Join x2 → Lock → Commit x2 → Reveal x2 → CardReveal x3 + Bet → Settle', async () => {
    const gameIdBytes = fromHex(GAME_ID);
    const commitments = await Promise.all(
      ENTROPIES.map(async (e, i) =>
        toHex(await commitEntropy(fromHex(e), fromHex(PLAYER_IDS[i]!), gameIdBytes)),
      ),
    );

    let cursor = -1;
    const awaitTableState = async (): Promise<ParsedTableState> => {
      const frame = await client.next((f) => {
        const idx = client.received.indexOf(f);
        return idx > cursor && f.type === MsgType.TableState;
      });
      cursor = client.received.indexOf(frame);
      return JSON.parse(new TextDecoder().decode(frame.payload)) as ParsedTableState;
    };
    const sendAndAwait = async (action: unknown): Promise<ParsedTableState> => {
      await sendAction(client, action);
      return awaitTableState();
    };

    // Joins.
    await sendAndAwait({
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'Join',
      action_nonce: nextNonce(),
      acting_player_seat: 0,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
      player_pubkey: PUBKEYS[0],
      stake_amount: 1000,
    });
    const afterJoin1 = await sendAndAwait({
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'Join',
      action_nonce: nextNonce(),
      acting_player_seat: 1,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
      player_pubkey: PUBKEYS[1],
      stake_amount: 1000,
    });
    expect(afterJoin1.players.length).toBe(2);

    // Lock.
    const locked = await sendAndAwait({
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'TableLock',
      action_nonce: nextNonce(),
      acting_player_seat: null,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
    });
    expect(locked.state_class).toBe('S3_ENTROPY_COMMIT_WINDOW');

    // Entropy commits.
    for (let i = 0; i < 2; i++) {
      await sendAndAwait({
        game_id: GAME_ID,
        round_number: 0,
        referenced_state_hash: '0'.repeat(64),
        action_type: 'EntropyCommit',
        action_nonce: nextNonce(),
        acting_player_seat: i,
        authorising_signature: 'sig',
        successor_state_commitment: '0'.repeat(64),
        commitment_hash: commitments[i],
      });
    }

    // Entropy reveals. After both, the relay materialises
    // combined_entropy + deck_commitment_hash in the TableState push.
    let postReveal: ParsedTableState | null = null;
    for (let i = 0; i < 2; i++) {
      postReveal = await sendAndAwait({
        game_id: GAME_ID,
        round_number: 0,
        referenced_state_hash: '0'.repeat(64),
        action_type: 'EntropyReveal',
        action_nonce: nextNonce(),
        acting_player_seat: i,
        authorising_signature: 'sig',
        successor_state_commitment: '0'.repeat(64),
        entropy: ENTROPIES[i],
      });
    }
    expect(postReveal!.state_class).toBe('S5_DECK_COMMITTED');
    expect(postReveal!.combined_entropy).not.toBeNull();
    expect(postReveal!.deck_commitment_hash).not.toBeNull();

    // Build the same deck commitment locally to derive valid reveal proofs.
    const combined = await combineEntropy(ENTROPIES.map((e) => fromHex(e)));
    const dc = await buildDeckCommitment(combined, 52, 1);

    // Sanity: combined_entropy reported by the relay matches our local derivation.
    expect(postReveal!.combined_entropy).toBe(toHex(combined));

    const cardRevealAction = (position: number) => {
      const p = dc.perPosition[position]!;
      return {
        game_id: GAME_ID,
        round_number: 0,
        referenced_state_hash: '0'.repeat(64),
        action_type: 'CardReveal',
        action_nonce: nextNonce(),
        acting_player_seat: null,
        authorising_signature: 'sig',
        successor_state_commitment: '0'.repeat(64),
        reveal: {
          position: p.position,
          revealed_card: { rank: '2', suit: 'clubs', ordinal: p.ordinal },
          card_nonce: toHex(p.cardNonce),
          deck_nonce: toHex(p.deckNonce),
        },
      };
    };

    // CardReveal position 0: S5 -> S6
    const afterCard0 = await sendAndAwait(cardRevealAction(0));
    expect(afterCard0.state_class).toBe('S6_CARD_REVEAL_FIRST');
    expect(afterCard0.visible_cards.length).toBe(1);

    // CardReveal position 1: S6 -> S8 (engine auto-advances S7 -> S8)
    const afterCard1 = await sendAndAwait(cardRevealAction(1));
    expect(afterCard1.state_class).toBe('S8_BET_DECISION');
    expect(afterCard1.acting_player_seat).not.toBeNull();

    // Bet.
    const afterBet = await sendAndAwait({
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'BetAction',
      action_nonce: nextNonce(),
      acting_player_seat: afterCard1.acting_player_seat,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
      bet_amount: 10,
    });
    expect(afterBet.state_class).toBe('S9_CARD_REVEAL_THIRD');
    expect(afterBet.pot_value).toBe(10);

    // CardReveal position 2: S9 -> S10
    const afterCard2 = await sendAndAwait(cardRevealAction(2));
    expect(afterCard2.state_class).toBe('S10_SETTLED_ROUND');

    // Settle: S10 -> S11
    const afterSettle = await sendAndAwait({
      game_id: GAME_ID,
      round_number: 0,
      referenced_state_hash: '0'.repeat(64),
      action_type: 'Settle',
      action_nonce: nextNonce(),
      acting_player_seat: afterCard2.acting_player_seat,
      authorising_signature: 'sig',
      successor_state_commitment: '0'.repeat(64),
    });
    expect(afterSettle.state_class).toBe('S11_ROTATE_TURN');
  });
});
