/**
 * Canonical BSV transaction shape.
 *
 * Mirrors the on-chain wire format byte-for-byte. Construction is
 * pure: every field is supplied by the caller, including the witness
 * (unlocking) scripts which the caller computes after running
 * `computeSighash` + signing externally.
 */

/** 32-byte little-endian transaction id (the reversed double-SHA-256 of the serialised tx). */
export type TxIdBytes = Uint8Array;

export interface TxInput {
  /** Previous transaction's txid, in **internal byte order** (not the user-facing reverse). */
  readonly prevTxid: TxIdBytes;
  /** Index of the previous output being spent. */
  readonly prevVout: number;
  /** Unlocking script bytes. May be empty for unsigned templates. */
  readonly unlockingScript: Uint8Array;
  /**
   * 4-byte little-endian sequence. Use 0xFFFFFFFF for "no relative
   * timelock"; non-final values combine with nLockTime to gate when
   * the input is spendable.
   */
  readonly sequence: number;
}

export interface TxOutput {
  /** Satoshi value (u64). */
  readonly value: bigint;
  /** Locking script bytes (from `@cardtable/script-templates`). */
  readonly lockingScript: Uint8Array;
}

export interface BsvTransaction {
  /** Transaction version (typically 1 or 2). */
  readonly version: number;
  readonly inputs: readonly TxInput[];
  readonly outputs: readonly TxOutput[];
  /**
   * nLockTime. Below 500_000_000 it's a block height; above, a Unix
   * timestamp. Combined with input.sequence to gate spending.
   */
  readonly lockTime: number;
}

/** SIGHASH flags. BSV post-Genesis uses the BIP-143 sighash scheme. */
export const SIGHASH_ALL = 0x01;
export const SIGHASH_NONE = 0x02;
export const SIGHASH_SINGLE = 0x03;
export const SIGHASH_FORKID = 0x40;
export const SIGHASH_ANYONECANPAY = 0x80;

/** Canonical BSV post-Genesis sighash byte: SIGHASH_ALL | SIGHASH_FORKID. */
export const SIGHASH_ALL_FORKID = SIGHASH_ALL | SIGHASH_FORKID;
