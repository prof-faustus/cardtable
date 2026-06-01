/**
 * Transaction orchestrator — turn `BuiltFallbackBranch` objects into
 * concrete unsigned BSV transactions. The orchestrator owns the
 * mapping from the protocol-level FallbackBranch shape to:
 *
 *   - input.sequence (relative-locktime delta for timeout branches)
 *   - tx.lockTime    (absolute height for recovery branches)
 *   - output.lockingScript (the next state's table-root template)
 *
 * Signing is the caller's responsibility: each call produces an
 * UNSIGNED transaction whose input has `unlockingScript = empty`.
 * The caller then runs `tx-builder.computeSighash` + `signSighash`
 * + assembles the unlocking script per the script-template branch
 * (preimage push + multisig).
 */

import type { BsvTransaction, TxInput, TxOutput } from '@cardtable/tx-builder';
import type { BuiltFallbackBranch } from './fallback-build.js';

/** Where the transaction spends from. */
export interface PrevOutpoint {
  /** 32-byte previous-tx id in internal byte order. */
  readonly prevTxid: Uint8Array;
  /** Index of the previous output. */
  readonly prevVout: number;
  /** Satoshis of the previous output (needed for BIP-143 sighash). */
  readonly prevValue: bigint;
}

/** Where the transaction's value goes. */
export interface SuccessorOutput {
  /** Satoshi value of the successor output. */
  readonly value: bigint;
  /** Locking script bytes (from `@cardtable/script-templates`). */
  readonly lockingScript: Uint8Array;
}

const TX_VERSION = 2;
/** Default nSequence when no relative-locktime is needed. */
const SEQUENCE_FINAL = 0xffffffff;
/**
 * BIP-68 sequence bit assignments:
 *   - bit 31 (0x80000000): disable flag — when set, sequence is just a
 *     final-flag and no relative-locktime constraint applies.
 *   - bit 22 (0x00400000): type flag — when set, sequence counts time
 *     (512-second units). When clear, sequence counts blocks.
 *
 * For block-counted relative locktime we mask with neither bit, and
 * the low 16 bits hold the block delta.
 */
function nSequenceForBlocks(blocks: number): number {
  if (blocks < 0 || blocks > 0xffff) {
    throw new Error(`nSequenceForBlocks: out of [0, 65535]: ${blocks}`);
  }
  return blocks & 0x0000ffff;
}

/**
 * Build the unsigned cooperative successor transaction for the given
 * built branch. The cooperative path is spendable immediately
 * (sequence = SEQUENCE_FINAL, lockTime = 0).
 */
export function buildCooperativeTx(args: {
  readonly prev: PrevOutpoint;
  readonly successor: SuccessorOutput;
}): BsvTransaction {
  const input: TxInput = {
    prevTxid: args.prev.prevTxid,
    prevVout: args.prev.prevVout,
    unlockingScript: new Uint8Array(0),
    sequence: SEQUENCE_FINAL,
  };
  const output: TxOutput = {
    value: args.successor.value,
    lockingScript: args.successor.lockingScript,
  };
  return {
    version: TX_VERSION,
    inputs: [input],
    outputs: [output],
    lockTime: 0,
  };
}

/**
 * Build the unsigned timeout transaction. The branch's
 * `locktime.kind === 'relative_blocks'` carries the delta — encoded
 * onto the input's nSequence per BIP-68. nLockTime stays 0 (the
 * timing gate is on the input, not the tx).
 */
export function buildTimeoutTx(args: {
  readonly branch: BuiltFallbackBranch;
  readonly prev: PrevOutpoint;
  readonly successor: SuccessorOutput;
}): BsvTransaction {
  if (args.branch.branch.kind !== 'timeout') {
    throw new Error(`buildTimeoutTx: expected branch kind 'timeout', got '${args.branch.branch.kind}'`);
  }
  if (!args.branch.locktime || args.branch.locktime.kind !== 'relative_blocks') {
    throw new Error(`buildTimeoutTx: branch.locktime must be relative_blocks`);
  }
  const blocks = args.branch.locktime.blocks;
  const input: TxInput = {
    prevTxid: args.prev.prevTxid,
    prevVout: args.prev.prevVout,
    unlockingScript: new Uint8Array(0),
    sequence: nSequenceForBlocks(blocks),
  };
  const output: TxOutput = {
    value: args.successor.value,
    lockingScript: args.successor.lockingScript,
  };
  return { version: TX_VERSION, inputs: [input], outputs: [output], lockTime: 0 };
}

/**
 * Build the unsigned recovery transaction. The branch's
 * `locktime.kind === 'absolute_height'` carries the gate — encoded
 * onto tx.lockTime. Input sequence must be < SEQUENCE_FINAL or the
 * lockTime is ignored by consensus; we use SEQUENCE_FINAL - 1 as
 * the canonical "lockTime active" value.
 */
export function buildRecoveryTx(args: {
  readonly branch: BuiltFallbackBranch;
  readonly prev: PrevOutpoint;
  readonly successor: SuccessorOutput;
}): BsvTransaction {
  if (args.branch.branch.kind !== 'recovery') {
    throw new Error(`buildRecoveryTx: expected branch kind 'recovery', got '${args.branch.branch.kind}'`);
  }
  if (!args.branch.locktime || args.branch.locktime.kind !== 'absolute_height') {
    throw new Error(`buildRecoveryTx: branch.locktime must be absolute_height`);
  }
  const height = args.branch.locktime.height;
  if (height >= 500_000_000) {
    throw new Error(`buildRecoveryTx: height ${height} would be interpreted as a Unix timestamp by consensus`);
  }
  const input: TxInput = {
    prevTxid: args.prev.prevTxid,
    prevVout: args.prev.prevVout,
    unlockingScript: new Uint8Array(0),
    sequence: SEQUENCE_FINAL - 1, // any value < SEQUENCE_FINAL makes lockTime active
  };
  const output: TxOutput = {
    value: args.successor.value,
    lockingScript: args.successor.lockingScript,
  };
  return { version: TX_VERSION, inputs: [input], outputs: [output], lockTime: height };
}
