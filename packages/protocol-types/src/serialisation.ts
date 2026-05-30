/**
 * Canonical binary serialisation primitives.
 *
 * Per `spec/serialisation.md` §2. These are the low-level encoders used
 * by every higher-level type's canonical-encode function.
 */

/** Maximum length of a single composite's reserved trailing bytes. */
export const MAX_RESERVED_TRAILING = 4096;

// ---------------------------------------------------------------------------
// Writer — append-only buffer
// ---------------------------------------------------------------------------

/**
 * A growable buffer for building a canonical encoding. Uses an
 * internal Uint8Array that doubles on overflow.
 */
export class CanonicalWriter {
  private buf: Uint8Array;
  private offset: number;

  constructor(initialCapacity = 256) {
    this.buf = new Uint8Array(initialCapacity);
    this.offset = 0;
  }

  /** Return the canonical bytes written so far (a copy). */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.offset);
  }

  /** Current number of bytes written. */
  length(): number {
    return this.offset;
  }

  private ensure(extra: number): void {
    const required = this.offset + extra;
    if (required <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < required) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.buf, 0);
    this.buf = grown;
  }

  writeU8(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xff) {
      throw new Error(`writeU8: out of range: ${v}`);
    }
    this.ensure(1);
    this.buf[this.offset++] = v;
  }

  writeBool(v: boolean): void {
    this.writeU8(v ? 0x01 : 0x00);
  }

  writeU16LE(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
      throw new Error(`writeU16LE: out of range: ${v}`);
    }
    this.ensure(2);
    this.buf[this.offset++] = v & 0xff;
    this.buf[this.offset++] = (v >> 8) & 0xff;
  }

  writeU32LE(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new Error(`writeU32LE: out of range: ${v}`);
    }
    this.ensure(4);
    this.buf[this.offset++] = v & 0xff;
    this.buf[this.offset++] = (v >>> 8) & 0xff;
    this.buf[this.offset++] = (v >>> 16) & 0xff;
    this.buf[this.offset++] = (v >>> 24) & 0xff;
  }

  /** Write a non-negative safe integer as 8 LE bytes. */
  writeU64LE(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) {
      throw new Error(`writeU64LE: out of range or unsafe: ${v}`);
    }
    this.ensure(8);
    // JavaScript bit ops are 32-bit; do high/low halves.
    const lo = v >>> 0;
    const hi = Math.floor(v / 0x100000000) >>> 0;
    this.buf[this.offset++] = lo & 0xff;
    this.buf[this.offset++] = (lo >>> 8) & 0xff;
    this.buf[this.offset++] = (lo >>> 16) & 0xff;
    this.buf[this.offset++] = (lo >>> 24) & 0xff;
    this.buf[this.offset++] = hi & 0xff;
    this.buf[this.offset++] = (hi >>> 8) & 0xff;
    this.buf[this.offset++] = (hi >>> 16) & 0xff;
    this.buf[this.offset++] = (hi >>> 24) & 0xff;
  }

  writeI32LE(v: number): void {
    if (!Number.isInteger(v) || v < -0x80000000 || v > 0x7fffffff) {
      throw new Error(`writeI32LE: out of range: ${v}`);
    }
    this.writeU32LE(v < 0 ? v + 0x100000000 : v);
  }

  /** Bitcoin-style varint: 1, 3, 5, or 9 bytes. */
  writeVarint(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new Error(`writeVarint: out of range: ${n}`);
    }
    if (n < 0xfd) {
      this.writeU8(n);
    } else if (n <= 0xffff) {
      this.writeU8(0xfd);
      this.writeU16LE(n);
    } else if (n <= 0xffffffff) {
      this.writeU8(0xfe);
      this.writeU32LE(n);
    } else {
      this.writeU8(0xff);
      this.writeU64LE(n);
    }
  }

  /** Write raw bytes (no length prefix). */
  writeRaw(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.offset);
    this.offset += data.length;
  }

  /** Write a length-prefixed byte string. */
  writeBytes(data: Uint8Array): void {
    this.writeVarint(data.length);
    this.writeRaw(data);
  }

  /** Write a length-prefixed UTF-8 string. */
  writeUtf8(s: string): void {
    const enc = new TextEncoder().encode(s);
    this.writeBytes(enc);
  }
}

// ---------------------------------------------------------------------------
// Reader — sequential consumer
// ---------------------------------------------------------------------------

/**
 * A sequential consumer for canonical bytes. Throws on EOF or
 * range violation; callers may catch and convert to a Result.
 */
export class CanonicalReader {
  private readonly buf: Uint8Array;
  private offset: number;

  constructor(data: Uint8Array, offset = 0) {
    this.buf = data;
    this.offset = offset;
  }

  pos(): number {
    return this.offset;
  }

  remaining(): number {
    return this.buf.length - this.offset;
  }

  private need(n: number): void {
    if (this.remaining() < n) {
      throw new Error(`CanonicalReader: short read (need ${n}, have ${this.remaining()})`);
    }
  }

  readU8(): number {
    this.need(1);
    const v = this.buf[this.offset];
    this.offset++;
    if (v === undefined) throw new Error('CanonicalReader: indexing failure');
    return v;
  }

  readBool(): boolean {
    const b = this.readU8();
    if (b === 0) return false;
    if (b === 1) return true;
    throw new Error(`readBool: invalid byte ${b}`);
  }

  readU16LE(): number {
    this.need(2);
    const a = this.buf[this.offset];
    const b = this.buf[this.offset + 1];
    if (a === undefined || b === undefined) throw new Error('CanonicalReader: indexing failure');
    this.offset += 2;
    return a | (b << 8);
  }

  readU32LE(): number {
    this.need(4);
    const a = this.buf[this.offset];
    const b = this.buf[this.offset + 1];
    const c = this.buf[this.offset + 2];
    const d = this.buf[this.offset + 3];
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error('CanonicalReader: indexing failure');
    }
    this.offset += 4;
    // Use unsigned shift so the result is in [0, 2^32-1].
    return (a | (b << 8) | (c << 16) | (d << 24)) >>> 0;
  }

  readU64LE(): number {
    this.need(8);
    const lo = this.readU32LE();
    const hi = this.readU32LE();
    const v = hi * 0x100000000 + lo;
    if (!Number.isSafeInteger(v)) {
      throw new Error(`readU64LE: value exceeds safe integer range`);
    }
    return v;
  }

  readVarint(): number {
    const b = this.readU8();
    if (b < 0xfd) return b;
    if (b === 0xfd) return this.readU16LE();
    if (b === 0xfe) return this.readU32LE();
    return this.readU64LE();
  }

  readRaw(n: number): Uint8Array {
    this.need(n);
    const slice = this.buf.slice(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  readBytes(cap: number = Number.MAX_SAFE_INTEGER): Uint8Array {
    const n = this.readVarint();
    if (n > cap) throw new Error(`readBytes: declared length ${n} exceeds cap ${cap}`);
    return this.readRaw(n);
  }

  readUtf8(cap: number = MAX_RESERVED_TRAILING): string {
    const bytes = this.readBytes(cap);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
}
