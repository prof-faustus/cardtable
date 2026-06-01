/**
 * Pinned BIP-143 sighash regression vector.
 *
 * Locks the tx-builder's `computeSighash` against a fixed input.
 * Any change in encoding rules, primitive layout, or hash domain
 * separation that would silently break BSV consensus compatibility
 * will fail this single assertion.
 *
 * The vector is internal (not copied from an external reference)
 * but is byte-deterministic — every conforming implementation that
 * follows BIP-143 + SIGHASH_FORKID on the same inputs MUST produce
 * the same digest. Updating the expected hex requires a deliberate
 * code change accompanied by a follow-up commit.
 */

import { describe, expect, it } from 'vitest';
import {
  SIGHASH_ALL_FORKID,
  computeSighash,
  encodeBsvTransaction,
} from '../src/index.js';
import type { BsvTransaction } from '../src/index.js';

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('fromHex: odd length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.byteLength; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

describe('tx-builder — pinned BIP-143 sighash vector', () => {
  it('produces a stable digest for a fixed (tx, prevScript, prevValue, hashType)', async () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [
        {
          prevTxid: fromHex('aa'.repeat(32)),
          prevVout: 0,
          unlockingScript: new Uint8Array(0),
          sequence: 0xffffffff,
        },
      ],
      outputs: [
        {
          value: 5000n,
          // OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG
          lockingScript: bytes(0x76, 0xa9, 0x14, ...Array.from({ length: 20 }, (_, i) => i), 0x88, 0xac),
        },
      ],
      lockTime: 0,
    };
    const prevScript = bytes(0x76, 0xa9, 0x14, ...Array.from({ length: 20 }, () => 0xff), 0x88, 0xac);
    const prevValue = 10000n;

    const digest = await computeSighash({
      tx,
      inputIdx: 0,
      prevScript,
      prevValue,
      hashType: SIGHASH_ALL_FORKID,
    });

    const hex = toHex(digest);
    // Canonical output for the fixture above. Locked across all
    // CI runners (Ubuntu/macOS/Windows × Node 20/22). Any change in
    // the encoder, sighash assembly, hash domain separation, or
    // SIGHASH-FORKID semantics that drifts from BSV consensus
    // compatibility trips this expectation.
    expect(hex).toBe('15b7dc05a4e49cfd12c725824793ca3607991659ef4940955b544e64de9faf4c');
  });

  it('encoded transaction length matches the canonical layout (sanity)', () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [
        {
          prevTxid: fromHex('11'.repeat(32)),
          prevVout: 0,
          unlockingScript: new Uint8Array(0),
          sequence: 0xffffffff,
        },
      ],
      outputs: [{ value: 0n, lockingScript: new Uint8Array(0) }],
      lockTime: 0,
    };
    const bytesOut = encodeBsvTransaction(tx);
    //   4 (version)
    // + 1 (varint input_count = 1)
    // + 32 + 4 + 1 + 0 + 4 (input fields)
    // + 1 (varint output_count = 1)
    // + 8 + 1 + 0 (output fields)
    // + 4 (lockTime)
    // = 60 bytes
    expect(bytesOut.byteLength).toBe(60);
  });
});
