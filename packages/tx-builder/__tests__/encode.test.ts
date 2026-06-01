import { describe, expect, it } from 'vitest';
import {
  SIGHASH_ALL_FORKID,
  computeSighash,
  computeTxId,
  decodeBsvTransaction,
  encodeBsvTransaction,
  signSighash,
  txidHex,
  verifySighashSignature,
} from '../src/index.js';
import type { BsvTransaction } from '../src/index.js';
import * as secp from '@noble/secp256k1';

const ZERO_TXID = new Uint8Array(32);

function dummyScript(b: number): Uint8Array {
  return new Uint8Array([0x76, 0xa9, b, 0x88, 0xac]); // OP_DUP OP_HASH160 <b> OP_EQUALVERIFY OP_CHECKSIG (1-byte hash)
}

describe('tx-builder — encode / decode round-trip', () => {
  it('round-trips a minimal one-input one-output transaction', () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 1000n, lockingScript: dummyScript(0x42) }],
      lockTime: 0,
    };
    const bytes = encodeBsvTransaction(tx);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const back = decodeBsvTransaction(bytes);
    expect(back.version).toBe(tx.version);
    expect(back.inputs).toHaveLength(1);
    expect(back.inputs[0]?.prevVout).toBe(0);
    expect(back.outputs).toHaveLength(1);
    expect(back.outputs[0]?.value).toBe(1000n);
    expect(back.lockTime).toBe(0);
  });

  it('encodes nLockTime as little-endian u32 at the end', () => {
    const tx: BsvTransaction = {
      version: 2,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xfffffffe }],
      outputs: [{ value: 0n, lockingScript: new Uint8Array(0) }],
      lockTime: 244,
    };
    const bytes = encodeBsvTransaction(tx);
    // Last 4 bytes are the lockTime in LE.
    expect(bytes[bytes.byteLength - 4]).toBe(0xf4);
    expect(bytes[bytes.byteLength - 3]).toBe(0x00);
    expect(bytes[bytes.byteLength - 2]).toBe(0x00);
    expect(bytes[bytes.byteLength - 1]).toBe(0x00);
  });

  it('rejects a tx with trailing bytes', () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 0n, lockingScript: new Uint8Array(0) }],
      lockTime: 0,
    };
    const bytes = encodeBsvTransaction(tx);
    const padded = new Uint8Array(bytes.byteLength + 1);
    padded.set(bytes, 0);
    expect(() => decodeBsvTransaction(padded)).toThrow(/trailing bytes/);
  });
});

describe('tx-builder — sighash', () => {
  it('rejects when SIGHASH_FORKID is missing (BSV requirement)', async () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 0n, lockingScript: new Uint8Array(0) }],
      lockTime: 0,
    };
    await expect(
      computeSighash({ tx, inputIdx: 0, prevScript: dummyScript(0x01), prevValue: 1000n, hashType: 0x01 }),
    ).rejects.toThrow(/SIGHASH_FORKID/);
  });

  it('produces a deterministic 32-byte digest for the same inputs', async () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 1000n, lockingScript: dummyScript(0x33) }],
      lockTime: 0,
    };
    const a = await computeSighash({ tx, inputIdx: 0, prevScript: dummyScript(0x77), prevValue: 2000n, hashType: SIGHASH_ALL_FORKID });
    const b = await computeSighash({ tx, inputIdx: 0, prevScript: dummyScript(0x77), prevValue: 2000n, hashType: SIGHASH_ALL_FORKID });
    expect(a.byteLength).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe('tx-builder — ECDSA signing', () => {
  it('signs a sighash and the result verifies under the matching pubkey', async () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 100n, lockingScript: dummyScript(0x44) }],
      lockTime: 0,
    };
    const priv = secp.utils.randomPrivateKey();
    const pub = secp.getPublicKey(priv, true);
    const sighash = await computeSighash({
      tx,
      inputIdx: 0,
      prevScript: dummyScript(0x55),
      prevValue: 500n,
      hashType: SIGHASH_ALL_FORKID,
    });
    const der = await signSighash(sighash, priv);
    expect(await verifySighashSignature(der, sighash, pub)).toBe(true);
  });

  it('rejects a signature under the wrong key', async () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 0n, lockingScript: new Uint8Array(0) }],
      lockTime: 0,
    };
    const alice = secp.utils.randomPrivateKey();
    const mallory = secp.getPublicKey(secp.utils.randomPrivateKey(), true);
    const sighash = await computeSighash({
      tx,
      inputIdx: 0,
      prevScript: dummyScript(0x66),
      prevValue: 1n,
      hashType: SIGHASH_ALL_FORKID,
    });
    const der = await signSighash(sighash, alice);
    expect(await verifySighashSignature(der, sighash, mallory)).toBe(false);
  });
});

describe('tx-builder — txid', () => {
  it('txidHex is reversed-byte order of computeTxId', async () => {
    const tx: BsvTransaction = {
      version: 1,
      inputs: [{ prevTxid: ZERO_TXID, prevVout: 0, unlockingScript: new Uint8Array(0), sequence: 0xffffffff }],
      outputs: [{ value: 0n, lockingScript: new Uint8Array(0) }],
      lockTime: 0,
    };
    const internal = await computeTxId(tx);
    const hex = await txidHex(tx);
    // First two hex chars of the reversed form correspond to the LAST byte of internal.
    expect(hex.substring(0, 2)).toBe(internal[31]!.toString(16).padStart(2, '0'));
    expect(hex).toHaveLength(64);
  });
});
