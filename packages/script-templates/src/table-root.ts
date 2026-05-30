/**
 * `table-root` template per `spec/script-templates.md` §2.1.
 *
 * Cooperative n-of-n CHECKMULTISIG or CLTV-gated operator refund.
 */

import type { BlockHeight, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface TableRootParams {
  /** All seated player pubkeys (or invited pubkeys for the open variant). */
  readonly seated_pubkeys: readonly Pubkey33[];
  /** Operator pubkey for the refund branch. */
  readonly operator_pubkey: Pubkey33;
  /** Absolute block height for the CLTV refund branch. */
  readonly recovery_height: BlockHeight;
}

/** Build the canonical bytes of a `table-root` locking script. */
export function buildTableRootLockingScript(p: TableRootParams): Uint8Array {
  if (p.seated_pubkeys.length === 0) {
    throw new Error('buildTableRootLockingScript: at least one pubkey required');
  }
  if (p.seated_pubkeys.length > 16) {
    // CHECKMULTISIG accepts m/n > 16 via CScriptNum push, but cardtable
    // tables are capped at 16 seats in v1. Increase here when the spec
    // raises the seat limit.
    throw new Error(
      `buildTableRootLockingScript: seat count ${p.seated_pubkeys.length} exceeds v1 max of 16`,
    );
  }
  const w = new ScriptWriter();
  w.op(OP.OP_IF);
  // Cooperative branch: N of N CHECKMULTISIG.
  w.pushNumber(p.seated_pubkeys.length);
  for (const pk of p.seated_pubkeys) w.pushPubkey(pk);
  w.pushNumber(p.seated_pubkeys.length);
  w.op(OP.OP_CHECKMULTISIG);
  w.op(OP.OP_ELSE);
  // CLTV refund branch.
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.operator_pubkey);
  w.op(OP.OP_CHECKSIG);
  w.op(OP.OP_ENDIF);
  return w.bytes();
}
