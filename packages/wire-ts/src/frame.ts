/**
 * Binary frame codec. Pure (Uint8Array, Frame) functions; no I/O.
 *
 * Format (little-endian, 16-byte header + payload):
 *
 *   Magic(4) | Version(2) | Type(2) | Length(4) | Checksum(4) | Payload
 *
 * Checksum is the first 4 bytes of SHA-256(payload). The async API is
 * required because Web Crypto's `subtle.digest` is async.
 */

import { HEADER_SIZE, MAX_PAYLOAD_SIZE, Magic, type MsgType } from './types.js';

/** One parsed wire frame. */
export interface Frame {
  readonly version: number;
  readonly type: MsgType;
  readonly payload: Uint8Array;
}

export class BadMagicError extends Error {
  constructor() {
    super('wire: bad magic (expected CARD)');
    this.name = 'BadMagicError';
  }
}
export class BadChecksumError extends Error {
  constructor() {
    super('wire: bad payload checksum');
    this.name = 'BadChecksumError';
  }
}
export class PayloadTooLargeError extends Error {
  constructor(size: number) {
    super(`wire: payload too large (${size} > ${MAX_PAYLOAD_SIZE})`);
    this.name = 'PayloadTooLargeError';
  }
}
export class ShortFrameError extends Error {
  constructor(have: number, need: number) {
    super(`wire: short frame (have ${have} bytes, need at least ${need})`);
    this.name = 'ShortFrameError';
  }
}

/**
 * Encode a frame as a fresh Uint8Array. The output's length is
 * HEADER_SIZE + payload.byteLength.
 */
export async function encode(frame: Frame): Promise<Uint8Array> {
  if (frame.payload.byteLength > MAX_PAYLOAD_SIZE) {
    throw new PayloadTooLargeError(frame.payload.byteLength);
  }
  const out = new Uint8Array(HEADER_SIZE + frame.payload.byteLength);
  out.set(Magic, 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint16(4, frame.version, true);
  view.setUint16(6, frame.type, true);
  view.setUint32(8, frame.payload.byteLength, true);
  const checksum = await checksumOf(frame.payload);
  out.set(checksum, 12);
  out.set(frame.payload, HEADER_SIZE);
  return out;
}

/**
 * Decode exactly one frame from the start of `buf`. Returns the parsed
 * Frame and the number of bytes consumed. Throws on parse error; the
 * underlying buffer is not mutated.
 */
export async function decode(buf: Uint8Array): Promise<{ frame: Frame; consumed: number }> {
  if (buf.byteLength < HEADER_SIZE) {
    throw new ShortFrameError(buf.byteLength, HEADER_SIZE);
  }
  if (buf[0] !== Magic[0] || buf[1] !== Magic[1] || buf[2] !== Magic[2] || buf[3] !== Magic[3]) {
    throw new BadMagicError();
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const version = view.getUint16(4, true);
  const type = view.getUint16(6, true) as MsgType;
  const length = view.getUint32(8, true);
  if (length > MAX_PAYLOAD_SIZE) {
    throw new PayloadTooLargeError(length);
  }
  const total = HEADER_SIZE + length;
  if (buf.byteLength < total) {
    throw new ShortFrameError(buf.byteLength, total);
  }
  const payload = buf.slice(HEADER_SIZE, total);
  const want = await checksumOf(payload);
  for (let i = 0; i < 4; i++) {
    if (buf[12 + i] !== want[i]) {
      throw new BadChecksumError();
    }
  }
  return { frame: { version, type, payload }, consumed: total };
}

async function checksumOf(payload: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer so the BufferSource type-check is
  // satisfied under TS 5.7+ where Uint8Array carries ArrayBufferLike
  // (which includes SharedArrayBuffer) rather than plain ArrayBuffer.
  // crypto.subtle is available in browsers and Node 20+.
  const buf = new ArrayBuffer(payload.byteLength);
  new Uint8Array(buf).set(payload);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest, 0, 4);
}
