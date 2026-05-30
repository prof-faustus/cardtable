/**
 * Low-level BSV script byte writer.
 *
 * Only the minimum needed by cardtable templates: push opcodes, push data
 * with minimal-push encoding, push CScriptNum for integers > 16, push
 * raw bytes.
 */

import { OP, opNumber } from './opcodes.js';

/** Minimal-push CScriptNum encoding (Bitcoin script numbers). */
export function encodeScriptNum(n: number): Uint8Array {
  if (!Number.isInteger(n)) throw new Error(`encodeScriptNum: non-integer ${n}`);
  if (n === 0) return new Uint8Array(0);
  const abs = Math.abs(n);
  const out: number[] = [];
  let v = abs;
  while (v > 0) {
    out.push(v & 0xff);
    v >>>= 8;
  }
  const last = out[out.length - 1];
  if (last === undefined) throw new Error('encodeScriptNum: indexing failure');
  if (last & 0x80) out.push(n < 0 ? 0x80 : 0x00);
  else if (n < 0) out[out.length - 1] = last | 0x80;
  return new Uint8Array(out);
}

/** Append-only script byte writer with minimal-push helpers. */
export class ScriptWriter {
  private buf: number[] = [];

  /** Number of bytes written. */
  size(): number {
    return this.buf.length;
  }

  /** Return the written bytes as a Uint8Array. */
  bytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }

  /** Append a single opcode. */
  op(op: number): this {
    if (!Number.isInteger(op) || op < 0 || op > 0xff) {
      throw new Error(`ScriptWriter.op: byte out of range ${op}`);
    }
    this.buf.push(op);
    return this;
  }

  /**
   * Push raw data using minimal encoding:
   *   length 0           -> OP_0
   *   length 1, byte 1..16 -> OP_1..OP_16
   *   length 1, byte 0x81 -> OP_1NEGATE
   *   length 1..75       -> [len] [data]
   *   length 76..255     -> OP_PUSHDATA1 [len] [data]
   *   length 256..65535  -> OP_PUSHDATA2 [lenLE] [data]
   *   otherwise          -> OP_PUSHDATA4 [lenLE] [data]
   */
  pushData(data: Uint8Array): this {
    const n = data.length;
    if (n === 0) {
      this.buf.push(OP.OP_0);
      return this;
    }
    if (n === 1) {
      const b = data[0];
      if (b === undefined) throw new Error('pushData: indexing failure');
      if (b >= 1 && b <= 16) {
        this.buf.push(OP.OP_1 + b - 1);
        return this;
      }
      if (b === 0x81) {
        this.buf.push(OP.OP_1NEGATE);
        return this;
      }
      this.buf.push(1, b);
      return this;
    }
    if (n <= 75) {
      this.buf.push(n);
      for (const b of data) this.buf.push(b);
      return this;
    }
    if (n <= 255) {
      this.buf.push(0x4c, n);
      for (const b of data) this.buf.push(b);
      return this;
    }
    if (n <= 65535) {
      this.buf.push(0x4d, n & 0xff, (n >> 8) & 0xff);
      for (const b of data) this.buf.push(b);
      return this;
    }
    this.buf.push(0x4e, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
    for (const b of data) this.buf.push(b);
    return this;
  }

  /** Push an integer using OP_N for 0..16 and CScriptNum push for larger. */
  pushNumber(n: number): this {
    if (n >= 0 && n <= 16 && Number.isInteger(n)) {
      this.buf.push(opNumber(n));
      return this;
    }
    return this.pushData(encodeScriptNum(n));
  }

  /** Push a 33-byte compressed public key as raw data. */
  pushPubkey(hex: string): this {
    if (!/^0[23][0-9a-f]{64}$/.test(hex)) {
      throw new Error(`pushPubkey: expected 33-byte compressed pubkey, got ${hex}`);
    }
    return this.pushData(hexToBytes(hex));
  }

  /** Push a 32-byte hash as raw data. */
  pushHash32(hex: string): this {
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      throw new Error(`pushHash32: expected 32 bytes of hex, got ${hex}`);
    }
    return this.pushData(hexToBytes(hex));
  }
}

/** Lowercase-hex -> Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hexToBytes: odd length`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(b)) throw new Error(`hexToBytes: non-hex at ${i}`);
    out[i] = b;
  }
  return out;
}

/** Bytes -> lowercase hex (for assertions and debug printing). */
export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    if (x === undefined) continue;
    s += x.toString(16).padStart(2, '0');
  }
  return s;
}
