/**
 * BSV post-Genesis BIP-143 sighash.
 *
 * Single canonical preimage format used by every modern BSV tx
 * (SIGHASH_FORKID must be set). Reference: bitcoinsv specification
 * 2017-bitcoin-cash-uahf, restored to BSV post-Genesis.
 *
 *   preimage = hashPrevouts (32)
 *           || hashSequence (32)
 *           || outpoint     (36)
 *           || scriptCode   (varint || bytes)
 *           || value        (8)
 *           || sequence     (4)
 *           || hashOutputs  (32)
 *           || lockTime     (4)
 *           || sighashType  (4)
 *
 * sighash = double-SHA-256(preimage).
 *
 * SIGHASH_NONE and SIGHASH_SINGLE variants zero out parts of the
 * preimage per the same spec. SIGHASH_ANYONECANPAY clears
 * hashPrevouts and hashSequence.
 */

import type { BsvTransaction } from './types.js';
import { SIGHASH_ALL, SIGHASH_ANYONECANPAY, SIGHASH_FORKID, SIGHASH_NONE, SIGHASH_SINGLE } from './types.js';
import { concat, encU32LE, encU64LE, encVarint } from './encode.js';

async function sha256(input: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(input.byteLength);
  new Uint8Array(buf).set(input);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

async function doubleSha256(input: Uint8Array): Promise<Uint8Array> {
  return sha256(await sha256(input));
}

const ZERO_32 = new Uint8Array(32);

function isBaseSighash(t: number, base: number): boolean {
  return (t & 0x1f) === base;
}

async function hashPrevouts(tx: BsvTransaction, hashType: number): Promise<Uint8Array> {
  if ((hashType & SIGHASH_ANYONECANPAY) !== 0) return ZERO_32;
  const parts: Uint8Array[] = [];
  for (const i of tx.inputs) {
    parts.push(i.prevTxid);
    parts.push(encU32LE(i.prevVout));
  }
  return doubleSha256(concat(...parts));
}

async function hashSequence(tx: BsvTransaction, hashType: number): Promise<Uint8Array> {
  if ((hashType & SIGHASH_ANYONECANPAY) !== 0) return ZERO_32;
  if (isBaseSighash(hashType, SIGHASH_NONE)) return ZERO_32;
  if (isBaseSighash(hashType, SIGHASH_SINGLE)) return ZERO_32;
  const parts: Uint8Array[] = [];
  for (const i of tx.inputs) parts.push(encU32LE(i.sequence));
  return doubleSha256(concat(...parts));
}

async function hashOutputs(tx: BsvTransaction, inputIdx: number, hashType: number): Promise<Uint8Array> {
  if (isBaseSighash(hashType, SIGHASH_ALL)) {
    const parts: Uint8Array[] = [];
    for (const o of tx.outputs) {
      parts.push(encU64LE(o.value));
      parts.push(encVarint(o.lockingScript.byteLength));
      parts.push(o.lockingScript);
    }
    return doubleSha256(concat(...parts));
  }
  if (isBaseSighash(hashType, SIGHASH_SINGLE) && inputIdx < tx.outputs.length) {
    const o = tx.outputs[inputIdx]!;
    return doubleSha256(concat(encU64LE(o.value), encVarint(o.lockingScript.byteLength), o.lockingScript));
  }
  return ZERO_32;
}

/**
 * Compute the BIP-143 sighash for `tx.inputs[inputIdx]` spending the
 * UTXO whose locking script is `prevScript` and whose value is
 * `prevValue` satoshis. The returned 32-byte digest is what gets
 * ECDSA-signed; the signature is then concatenated with the 1-byte
 * `hashType` and pushed onto the unlocking script.
 *
 * SIGHASH_FORKID MUST be set on `hashType` (BSV-mandatory).
 */
export async function computeSighash(args: {
  readonly tx: BsvTransaction;
  readonly inputIdx: number;
  readonly prevScript: Uint8Array;
  readonly prevValue: bigint;
  readonly hashType: number;
}): Promise<Uint8Array> {
  const { tx, inputIdx, prevScript, prevValue, hashType } = args;
  if ((hashType & SIGHASH_FORKID) === 0) {
    throw new Error('computeSighash: BSV requires SIGHASH_FORKID');
  }
  if (inputIdx < 0 || inputIdx >= tx.inputs.length) {
    throw new Error(`computeSighash: inputIdx ${inputIdx} out of range`);
  }
  const i = tx.inputs[inputIdx]!;
  const preimage = concat(
    new Uint8Array([tx.version & 0xff, (tx.version >> 8) & 0xff, (tx.version >> 16) & 0xff, (tx.version >> 24) & 0xff]),
    await hashPrevouts(tx, hashType),
    await hashSequence(tx, hashType),
    i.prevTxid,
    encU32LE(i.prevVout),
    encVarint(prevScript.byteLength),
    prevScript,
    encU64LE(prevValue),
    encU32LE(i.sequence),
    await hashOutputs(tx, inputIdx, hashType),
    encU32LE(tx.lockTime),
    encU32LE(hashType),
  );
  return doubleSha256(preimage);
}
