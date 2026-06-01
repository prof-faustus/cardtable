/**
 * Canonical BSV transaction encoder + decoder.
 *
 * Format (little-endian, no witness data — BSV post-Genesis uses the
 * legacy UTXO model without SegWit):
 *
 *   version             i32 LE
 *   input_count         varint
 *   for each input:
 *     prev_txid         32 bytes (internal byte order)
 *     prev_vout         u32 LE
 *     unlocking_len     varint
 *     unlocking_script  bytes
 *     sequence          u32 LE
 *   output_count        varint
 *   for each output:
 *     value             u64 LE (satoshis)
 *     locking_len       varint
 *     locking_script    bytes
 *   lock_time           u32 LE
 */

import type { BsvTransaction, TxInput, TxOutput } from './types.js';

// ---------------------------------------------------------------------------
// Primitive encoders
// ---------------------------------------------------------------------------

export function encVarint(n: number | bigint): Uint8Array {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (v < 0n) throw new Error(`encVarint: negative ${v}`);
  if (v < 0xfdn) return new Uint8Array([Number(v)]);
  if (v <= 0xffffn) {
    const out = new Uint8Array(3);
    out[0] = 0xfd;
    new DataView(out.buffer).setUint16(1, Number(v), true);
    return out;
  }
  if (v <= 0xffffffffn) {
    const out = new Uint8Array(5);
    out[0] = 0xfe;
    new DataView(out.buffer).setUint32(1, Number(v), true);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = 0xff;
  new DataView(out.buffer).setBigUint64(1, v, true);
  return out;
}

export function encU32LE(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

export function encI32LE(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, n, true);
  return out;
}

export function encU64LE(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

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

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

interface Cursor {
  buf: Uint8Array;
  pos: number;
}

function readU8(c: Cursor): number {
  const b = c.buf[c.pos];
  if (b === undefined) throw new Error('decode: out of bounds u8');
  c.pos += 1;
  return b;
}

function readU16LE(c: Cursor): number {
  const v = new DataView(c.buf.buffer, c.buf.byteOffset + c.pos, 2).getUint16(0, true);
  c.pos += 2;
  return v;
}

function readU32LE(c: Cursor): number {
  const v = new DataView(c.buf.buffer, c.buf.byteOffset + c.pos, 4).getUint32(0, true);
  c.pos += 4;
  return v;
}

function readI32LE(c: Cursor): number {
  const v = new DataView(c.buf.buffer, c.buf.byteOffset + c.pos, 4).getInt32(0, true);
  c.pos += 4;
  return v;
}

function readU64LE(c: Cursor): bigint {
  const v = new DataView(c.buf.buffer, c.buf.byteOffset + c.pos, 8).getBigUint64(0, true);
  c.pos += 8;
  return v;
}

function readVarint(c: Cursor): number | bigint {
  const first = readU8(c);
  if (first < 0xfd) return first;
  if (first === 0xfd) return readU16LE(c);
  if (first === 0xfe) return readU32LE(c);
  return readU64LE(c);
}

function readBytes(c: Cursor, n: number): Uint8Array {
  if (c.pos + n > c.buf.byteLength) throw new Error('decode: out of bounds bytes');
  const out = c.buf.slice(c.pos, c.pos + n);
  c.pos += n;
  return out;
}

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

function encInput(i: TxInput): Uint8Array {
  if (i.prevTxid.byteLength !== 32) {
    throw new Error(`encInput: prevTxid must be 32 bytes, got ${i.prevTxid.byteLength}`);
  }
  return concat(
    i.prevTxid,
    encU32LE(i.prevVout),
    encVarint(i.unlockingScript.byteLength),
    i.unlockingScript,
    encU32LE(i.sequence),
  );
}

function encOutput(o: TxOutput): Uint8Array {
  return concat(
    encU64LE(o.value),
    encVarint(o.lockingScript.byteLength),
    o.lockingScript,
  );
}

/** Encode a transaction to its canonical wire bytes. */
export function encodeBsvTransaction(tx: BsvTransaction): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encI32LE(tx.version));
  parts.push(encVarint(tx.inputs.length));
  for (const i of tx.inputs) parts.push(encInput(i));
  parts.push(encVarint(tx.outputs.length));
  for (const o of tx.outputs) parts.push(encOutput(o));
  parts.push(encU32LE(tx.lockTime));
  return concat(...parts);
}

/** Decode a transaction from its canonical wire bytes. */
export function decodeBsvTransaction(buf: Uint8Array): BsvTransaction {
  const c: Cursor = { buf, pos: 0 };
  const version = readI32LE(c);
  const inputCount = Number(readVarint(c));
  const inputs: TxInput[] = [];
  for (let i = 0; i < inputCount; i++) {
    const prevTxid = readBytes(c, 32);
    const prevVout = readU32LE(c);
    const scriptLen = Number(readVarint(c));
    const unlockingScript = readBytes(c, scriptLen);
    const sequence = readU32LE(c);
    inputs.push({ prevTxid, prevVout, unlockingScript, sequence });
  }
  const outputCount = Number(readVarint(c));
  const outputs: TxOutput[] = [];
  for (let i = 0; i < outputCount; i++) {
    const value = readU64LE(c);
    const scriptLen = Number(readVarint(c));
    const lockingScript = readBytes(c, scriptLen);
    outputs.push({ value, lockingScript });
  }
  const lockTime = readU32LE(c);
  if (c.pos !== buf.byteLength) {
    throw new Error(`decodeBsvTransaction: trailing bytes (consumed ${c.pos} of ${buf.byteLength})`);
  }
  return { version, inputs, outputs, lockTime };
}
