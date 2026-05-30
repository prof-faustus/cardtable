import { describe, it, expect } from 'vitest';
import {
  CanonicalReader,
  CanonicalWriter,
  bytesToHex,
  hexToBytes,
} from '../src/index.js';

describe('CanonicalWriter primitives', () => {
  it('writes u8 correctly', () => {
    const w = new CanonicalWriter();
    w.writeU8(0);
    w.writeU8(255);
    expect(Array.from(w.bytes())).toEqual([0, 255]);
  });

  it('writes u16 LE', () => {
    const w = new CanonicalWriter();
    w.writeU16LE(0x1234);
    expect(Array.from(w.bytes())).toEqual([0x34, 0x12]);
  });

  it('writes u32 LE', () => {
    const w = new CanonicalWriter();
    w.writeU32LE(0xdeadbeef);
    expect(Array.from(w.bytes())).toEqual([0xef, 0xbe, 0xad, 0xde]);
  });

  it('writes u64 LE for safe integers', () => {
    const w = new CanonicalWriter();
    w.writeU64LE(0x0000000100000002);
    expect(Array.from(w.bytes())).toEqual([0x02, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]);
  });

  it('writes varint for small values as single byte', () => {
    const w = new CanonicalWriter();
    w.writeVarint(0);
    w.writeVarint(252);
    expect(Array.from(w.bytes())).toEqual([0, 252]);
  });

  it('writes varint for [0xfd, 0xffff] as 3 bytes', () => {
    const w = new CanonicalWriter();
    w.writeVarint(0xfd);
    expect(Array.from(w.bytes())).toEqual([0xfd, 0xfd, 0x00]);
  });

  it('writes varint for [0x10000, 0xffffffff] as 5 bytes', () => {
    const w = new CanonicalWriter();
    w.writeVarint(0x10000);
    expect(Array.from(w.bytes())).toEqual([0xfe, 0x00, 0x00, 0x01, 0x00]);
  });

  it('writes bool as 0x00 / 0x01', () => {
    const w = new CanonicalWriter();
    w.writeBool(true);
    w.writeBool(false);
    expect(Array.from(w.bytes())).toEqual([1, 0]);
  });

  it('rejects out-of-range u8', () => {
    const w = new CanonicalWriter();
    expect(() => w.writeU8(256)).toThrow();
    expect(() => w.writeU8(-1)).toThrow();
  });

  it('roundtrips bytes and utf8', () => {
    const w = new CanonicalWriter();
    w.writeBytes(new Uint8Array([1, 2, 3, 4]));
    w.writeUtf8('hello');
    const r = new CanonicalReader(w.bytes());
    expect(Array.from(r.readBytes())).toEqual([1, 2, 3, 4]);
    expect(r.readUtf8()).toBe('hello');
  });
});

describe('CanonicalReader', () => {
  it('reads primitives back identically', () => {
    const w = new CanonicalWriter();
    w.writeU8(7);
    w.writeU16LE(0xabcd);
    w.writeU32LE(0x12345678);
    w.writeU64LE(0x123456);
    w.writeBool(true);
    w.writeVarint(0xfd);
    w.writeVarint(0x10000);
    const r = new CanonicalReader(w.bytes());
    expect(r.readU8()).toBe(7);
    expect(r.readU16LE()).toBe(0xabcd);
    expect(r.readU32LE()).toBe(0x12345678);
    expect(r.readU64LE()).toBe(0x123456);
    expect(r.readBool()).toBe(true);
    expect(r.readVarint()).toBe(0xfd);
    expect(r.readVarint()).toBe(0x10000);
  });

  it('throws on short read', () => {
    const r = new CanonicalReader(new Uint8Array([0x01]));
    r.readU8();
    expect(() => r.readU8()).toThrow();
  });

  it('rejects invalid bool', () => {
    const r = new CanonicalReader(new Uint8Array([0x02]));
    expect(() => r.readBool()).toThrow();
  });
});

describe('hex helpers', () => {
  it('roundtrips lowercase hex', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('deadbeef');
    expect(Array.from(hexToBytes(hex))).toEqual(Array.from(bytes));
  });
  it('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
  it('rejects non-hex', () => {
    expect(() => hexToBytes('xy')).toThrow();
  });
});
