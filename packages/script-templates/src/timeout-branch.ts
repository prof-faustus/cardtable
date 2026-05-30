/**
 * Standalone timeout-branch builder.
 *
 * In production this is part of the larger `round-state` or
 * `entropy-commit` script. This module provides a standalone form
 * useful for tests and for the pre-signed fallback graph builder.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface TimeoutBranchParams {
  /** CSV-relative blocks since state established. */
  readonly decision_timeout_blocks: number;
  /** HASH256 commitment to the timeout-template body. */
  readonly timeout_template_hash: Hash256;
  /** The set of pubkeys whose multisig (n-of-n) authorises the timeout tx. */
  readonly authoriser_pubkeys: readonly Pubkey33[];
}

export function buildTimeoutBranchScript(p: TimeoutBranchParams): Uint8Array {
  if (p.authoriser_pubkeys.length === 0) {
    throw new Error('buildTimeoutBranchScript: at least one authoriser required');
  }
  if (p.authoriser_pubkeys.length > 16) {
    throw new Error('buildTimeoutBranchScript: authoriser count > 16 not supported in v1');
  }
  const w = new ScriptWriter();
  w.pushNumber(p.decision_timeout_blocks);
  w.op(OP.OP_CHECKSEQUENCEVERIFY);
  w.op(OP.OP_DROP);
  w.op(OP.OP_HASH256);
  w.pushHash32(p.timeout_template_hash);
  w.op(OP.OP_EQUALVERIFY);
  w.pushNumber(p.authoriser_pubkeys.length);
  for (const pk of p.authoriser_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.authoriser_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  return w.bytes();
}
