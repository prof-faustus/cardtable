/**
 * RelayClient — browser-side WebSocket adapter for the cardtable
 * binary wire protocol.
 *
 * Every outbound `send(...)` encodes one wire.Frame and posts it as a
 * single WebSocket binary message; every inbound binary message is
 * decoded back into a wire.Frame. The transport layering is:
 *
 *   browser app  <->  RelayClient  <->  WebSocket  <->  Go wsadapter
 *
 * The Go relay's session.Submit is the same backend that drives the
 * TCP relay path — so mental-poker verification (entropy reveal +
 * card reveal) happens identically over either transport.
 */

import { MsgType, VERSION_1_0, decode, encode, type Frame } from '@cardtable/wire-ts';

/** Event payloads emitted by the RelayClient. */
export type RelayEvent =
  | { readonly kind: 'open' }
  | { readonly kind: 'close'; readonly code: number; readonly reason: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'frame'; readonly frame: Frame };

export type RelayListener = (ev: RelayEvent) => void;

export interface RelayConfig {
  /** WebSocket URL, e.g. ws://localhost:8081/ws */
  readonly url: string;
}

/**
 * RelayClient is a single-table relay session over WebSocket.
 *
 * Use:
 *   const c = new RelayClient({ url: 'ws://localhost:8081/ws' });
 *   c.subscribe((ev) => { ... });
 *   await c.connect();
 *   await c.sendAction(myJsonObject);
 */
export class RelayClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private listeners = new Set<RelayListener>();
  private opening: Promise<void> | null = null;

  constructor(cfg: RelayConfig) {
    this.url = cfg.url;
  }

  subscribe(fn: RelayListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Open the connection. Resolves when the socket reaches OPEN. */
  connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.opening) return this.opening;

    this.opening = new Promise<void>((resolve, reject) => {
      let settled = false;
      try {
        this.socket = new WebSocket(this.url);
      } catch (e) {
        this.opening = null;
        reject(e);
        return;
      }
      this.socket.binaryType = 'arraybuffer';
      this.socket.onopen = () => {
        this.opening = null;
        settled = true;
        this.emit({ kind: 'open' });
        resolve();
      };
      this.socket.onmessage = (ev) => {
        void this.handleMessage(ev.data);
      };
      this.socket.onclose = (ev) => {
        this.emit({ kind: 'close', code: ev.code, reason: ev.reason });
      };
      this.socket.onerror = () => {
        const msg = 'websocket error';
        this.emit({ kind: 'error', message: msg });
        if (!settled) {
          this.opening = null;
          reject(new Error(msg));
        }
      };
    });
    return this.opening;
  }

  /** Tear the connection down. */
  close(code = 1000, reason = 'client closed'): void {
    if (!this.socket) return;
    this.socket.close(code, reason);
    this.socket = null;
  }

  /** Send one wire.Frame across the wire. */
  async sendFrame(frame: Frame): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('RelayClient.sendFrame: socket not open');
    }
    const bytes = await encode(frame);
    // Pass the underlying ArrayBuffer; some browsers reject views
    // sliced over SharedArrayBuffer when the WS uses BinaryType
    // 'arraybuffer'.
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    this.socket.send(buf);
  }

  /** Submit a SignedAction (JSON-encoded payload). */
  async sendAction(action: unknown): Promise<void> {
    const payload = new TextEncoder().encode(JSON.stringify(action));
    await this.sendFrame({ version: VERSION_1_0, type: MsgType.Action, payload });
  }

  /** Request the audit transcript. */
  async requestTranscript(): Promise<void> {
    await this.sendFrame({
      version: VERSION_1_0,
      type: MsgType.TranscriptRequest,
      payload: new Uint8Array(0),
    });
  }

  /** Send an application-level ping (round-trip is observable via the open event stream). */
  async ping(payload: Uint8Array = new Uint8Array(0)): Promise<void> {
    await this.sendFrame({ version: VERSION_1_0, type: MsgType.Ping, payload });
  }

  private async handleMessage(data: ArrayBuffer | string): Promise<void> {
    if (typeof data === 'string') {
      this.emit({ kind: 'error', message: 'text frame received; binary only' });
      return;
    }
    const bytes = new Uint8Array(data);
    try {
      const { frame } = await decode(bytes);
      this.emit({ kind: 'frame', frame });
    } catch (e) {
      this.emit({ kind: 'error', message: `decode failed: ${(e as Error).message}` });
    }
  }

  private emit(ev: RelayEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {
        // Listener errors are swallowed so one bad subscriber cannot
        // poison the rest of the fan-out.
      }
    }
  }
}
