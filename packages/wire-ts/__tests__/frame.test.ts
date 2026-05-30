import { describe, it, expect } from 'vitest';
import {
  BadChecksumError,
  BadMagicError,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  MsgType,
  PayloadTooLargeError,
  ShortFrameError,
  VERSION_1_0,
  decode,
  encode,
} from '../src/index.js';

describe('wire frame codec', () => {
  it('round-trips a binary frame', async () => {
    const payload = new TextEncoder().encode('{"hello":"world"}');
    const buf = await encode({ version: VERSION_1_0, type: MsgType.Action, payload });
    expect(buf.byteLength).toBe(HEADER_SIZE + payload.byteLength);
    const { frame, consumed } = await decode(buf);
    expect(consumed).toBe(buf.byteLength);
    expect(frame.version).toBe(VERSION_1_0);
    expect(frame.type).toBe(MsgType.Action);
    expect(new TextDecoder().decode(frame.payload)).toBe('{"hello":"world"}');
  });

  it('handles empty payload', async () => {
    const buf = await encode({ version: VERSION_1_0, type: MsgType.Ping, payload: new Uint8Array(0) });
    expect(buf.byteLength).toBe(HEADER_SIZE);
    const { frame } = await decode(buf);
    expect(frame.type).toBe(MsgType.Ping);
    expect(frame.payload.byteLength).toBe(0);
  });

  it('rejects bad magic', async () => {
    const bad = new Uint8Array(HEADER_SIZE);
    bad.fill(0xff, 0, 4);
    await expect(decode(bad)).rejects.toBeInstanceOf(BadMagicError);
  });

  it('rejects bad checksum', async () => {
    const payload = new TextEncoder().encode('abc');
    const buf = await encode({ version: VERSION_1_0, type: MsgType.Action, payload });
    buf[12] ^= 0xff; // corrupt one checksum byte
    await expect(decode(buf)).rejects.toBeInstanceOf(BadChecksumError);
  });

  it('rejects truncated frame', async () => {
    await expect(decode(new Uint8Array([0x43, 0x41]))).rejects.toBeInstanceOf(ShortFrameError);
  });

  it('rejects oversized declared length on decode', async () => {
    const hdr = new Uint8Array(HEADER_SIZE);
    hdr[0] = 0x43;
    hdr[1] = 0x41;
    hdr[2] = 0x52;
    hdr[3] = 0x44;
    new DataView(hdr.buffer).setUint32(8, MAX_PAYLOAD_SIZE + 1, true);
    await expect(decode(hdr)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('rejects oversized payload on encode', async () => {
    // Constructing a 32+ MiB Uint8Array in CI is fine; we just need
    // the size check to trip — use a synthetic length via a small
    // sparse buffer would require lying about byteLength, so just
    // allocate one byte over the cap. To avoid actually allocating
    // 32 MiB in this test, skip the allocation path: we test the
    // decode path above (which doesn't allocate) and rely on the
    // shared size check being symmetric.
    const oversized = new Uint8Array(MAX_PAYLOAD_SIZE + 1);
    await expect(
      encode({ version: VERSION_1_0, type: MsgType.Action, payload: oversized }),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  it('encodes back-to-back frames that decode independently', async () => {
    const a = await encode({ version: VERSION_1_0, type: MsgType.Ping, payload: new Uint8Array([1]) });
    const b = await encode({ version: VERSION_1_0, type: MsgType.Ping, payload: new Uint8Array([2, 3]) });
    const combined = new Uint8Array(a.byteLength + b.byteLength);
    combined.set(a, 0);
    combined.set(b, a.byteLength);

    const first = await decode(combined);
    expect(first.consumed).toBe(a.byteLength);
    expect(Array.from(first.frame.payload)).toEqual([1]);

    const second = await decode(combined.subarray(first.consumed));
    expect(second.consumed).toBe(b.byteLength);
    expect(Array.from(second.frame.payload)).toEqual([2, 3]);
  });
});
