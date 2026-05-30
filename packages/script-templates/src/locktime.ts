/**
 * Transaction-level locktime specifications.
 *
 * Cardtable scripts contain **no** in-script timelock opcodes. Every
 * time-gated branch is enforced by the **spending** transaction's
 * `nLockTime` field together with one or more non-final input
 * `nSequence` values (consensus only enforces `nLockTime` when at
 * least one input is non-final). This module declares the shapes the
 * downstream transaction builder uses to set those fields.
 */

import type { BlockHeight } from '@cardtable/protocol-types';

/**
 * A spending transaction's locktime contract. The builder reads this
 * and writes the corresponding `nLockTime` / `nSequence` values onto
 * the spending transaction.
 */
export type LockTimeSpec =
  | {
      readonly kind: 'immediate';
    }
  | {
      readonly kind: 'absolute_height';
      readonly not_before_height: BlockHeight;
      /** Per-input nSequence override; default 0 (non-final). */
      readonly input_sequence?: number;
    }
  | {
      readonly kind: 'relative_blocks';
      /**
       * Number of blocks the input must be confirmed for before the
       * spend is valid. Encoded in the spending input's nSequence
       * relative-locktime semantics of the original protocol.
       */
      readonly blocks_since_input_confirmation: number;
    };

/** Convenience constructors. */
export const immediate: LockTimeSpec = { kind: 'immediate' };

export function absoluteHeight(h: BlockHeight, inputSequence = 0): LockTimeSpec {
  return { kind: 'absolute_height', not_before_height: h, input_sequence: inputSequence };
}

export function relativeBlocks(blocks: number): LockTimeSpec {
  if (!Number.isInteger(blocks) || blocks < 1) {
    throw new Error(`relativeBlocks: must be a positive integer (got ${blocks})`);
  }
  return { kind: 'relative_blocks', blocks_since_input_confirmation: blocks };
}
