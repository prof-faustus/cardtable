/**
 * Canonical primitive encoders per `spec/serialisation.md` §2.1.
 *
 * Every byte sequence produced here is deterministic across
 * implementations. Used as the input to `domainHash` for commitment
 * construction.
 */

const HEX_TABLE: readonly string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < 256; i++) {
    out.push(i.toString(16).padStart(2, '0'));
  }
  return out;
})();

/** u8 → 1 raw byte. */
export function encodeU8(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xff) {
    throw new Error(`encodeU8: out of range: ${n}`);
  }
  return new Uint8Array([n]);
}

/** u16 little-endian → 2 raw bytes. */
export function encodeU16LE(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new Error(`encodeU16LE: out of range: ${n}`);
  }
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

/** u32 little-endian → 4 raw bytes. */
export function encodeU32LE(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`encodeU32LE: out of range: ${n}`);
  }
  return new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
}

/** Exactly 32 raw bytes — used for hashes and pubkey-hashes. */
export function encodeBytes32(b: Uint8Array): Uint8Array {
  if (b.byteLength !== 32) {
    throw new Error(`encodeBytes32: expected 32 bytes, got ${b.byteLength}`);
  }
  return b;
}

/** Bitcoin-style varint (1, 3, 5, or 9 bytes). */
export function encodeVarint(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`encodeVarint: out of range: ${n}`);
  }
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 0xfd;
    out[1] = n & 0xff;
    out[2] = (n >>> 8) & 0xff;
    return out;
  }
  if (n <= 0xffffffff) {
    const out = new Uint8Array(5);
    out[0] = 0xfe;
    new DataView(out.buffer).setUint32(1, n, true);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = 0xff;
  const high = Math.floor(n / 0x100000000);
  const low = n >>> 0;
  new DataView(out.buffer).setUint32(1, low, true);
  new DataView(out.buffer).setUint32(5, high, true);
  return out;
}

/** Concatenate any number of byte slices. */
export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** Lowercase hex of a Uint8Array. */
export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.byteLength; i++) {
    s += HEX_TABLE[b[i] as number];
  }
  return s;
}

/** Parse a 64-char (or arbitrary even-length) hex string into a Uint8Array. */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`fromHex: odd-length input: ${hex}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.byteLength; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`fromHex: bad hex at offset ${i * 2}: ${hex}`);
    }
    out[i] = byte;
  }
  return out;
}
