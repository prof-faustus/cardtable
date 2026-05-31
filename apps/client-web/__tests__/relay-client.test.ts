/**
 * RelayClient unit tests. These exercise the framing path against a
 * stubbed WebSocket — no real network is opened. The wire codec is
 * tested separately under packages/wire-ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MsgType, VERSION_1_0, decode, encode } from '@cardtable/wire-ts';
import { RelayClient } from '../src/relay-client.js';

// ---------------------------------------------------------------------------
// Stub WebSocket
// ---------------------------------------------------------------------------

type WsHandler = (this: void, ev: { data: ArrayBuffer | string; code?: number; reason?: string }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = 0; // CONNECTING
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  sent: ArrayBuffer[] = [];

  onopen: ((ev: unknown) => void) | null = null;
  onmessage: WsHandler | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(payload: ArrayBuffer | ArrayBufferView | string): void {
    if (payload instanceof ArrayBuffer) {
      this.sent.push(payload);
    } else if (ArrayBuffer.isView(payload)) {
      const view = payload as ArrayBufferView;
      const copy = new ArrayBuffer(view.byteLength);
      new Uint8Array(copy).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      this.sent.push(copy);
    } else {
      throw new Error('FakeWebSocket only handles binary sends');
    }
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  // Test helpers.
  fakeOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  fakeMessage(payload: ArrayBuffer): void {
    this.onmessage?.({ data: payload });
  }
  fakeError(): void {
    this.onerror?.({});
  }
}

// Patch the global WebSocket constructor for the duration of these tests.
const realWs = globalThis.WebSocket;
beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;
  // Mirror the static enum values WebSocket exposes.
  (FakeWebSocket as unknown as { OPEN: number }).OPEN = 1;
  (FakeWebSocket as unknown as { CONNECTING: number }).CONNECTING = 0;
});
afterEach(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = realWs;
  vi.restoreAllMocks();
});

describe('RelayClient', () => {
  it('connect() resolves on open and emits an open event', async () => {
    const c = new RelayClient({ url: 'ws://test/ws' });
    const events: string[] = [];
    c.subscribe((ev) => events.push(ev.kind));

    const pending = c.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.fakeOpen();
    await pending;

    expect(events).toEqual(['open']);
  });

  it('sendAction() encodes a wire frame the server can decode', async () => {
    const c = new RelayClient({ url: 'ws://test/ws' });
    const pending = c.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.fakeOpen();
    await pending;

    await c.sendAction({ action_type: 'Join', stake_amount: 1000 });

    expect(ws.sent).toHaveLength(1);
    const sent = new Uint8Array(ws.sent[0]!);
    const { frame } = await decode(sent);
    expect(frame.version).toBe(VERSION_1_0);
    expect(frame.type).toBe(MsgType.Action);
    const body = JSON.parse(new TextDecoder().decode(frame.payload));
    expect(body).toEqual({ action_type: 'Join', stake_amount: 1000 });
  });

  it('an incoming binary frame is decoded and surfaced to subscribers', async () => {
    const c = new RelayClient({ url: 'ws://test/ws' });
    const events: { kind: string; type?: number }[] = [];
    c.subscribe((ev) => {
      if (ev.kind === 'frame') events.push({ kind: ev.kind, type: ev.frame.type });
      else events.push({ kind: ev.kind });
    });
    const pending = c.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.fakeOpen();
    await pending;

    const frame = await encode({ version: VERSION_1_0, type: MsgType.TableState, payload: new TextEncoder().encode('{}') });
    ws.fakeMessage(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));

    // The receive path is async because crypto.subtle.digest is async.
    await new Promise((r) => setTimeout(r, 5));

    const frameEvents = events.filter((e) => e.kind === 'frame');
    expect(frameEvents).toHaveLength(1);
    expect(frameEvents[0]!.type).toBe(MsgType.TableState);
  });

  it('sendFrame rejects if the socket is not open', async () => {
    const c = new RelayClient({ url: 'ws://test/ws' });
    await expect(
      c.sendFrame({ version: VERSION_1_0, type: MsgType.Ping, payload: new Uint8Array(0) }),
    ).rejects.toThrow(/socket not open/);
  });
});
