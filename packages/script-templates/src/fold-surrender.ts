/**
 * `fold-surrender` template — the output produced by a fold.
 *
 * Per `spec/script-templates.md` §2.6 (Phase 4+ extended model only).
 * Locks the concealed card so the only exit is the recovery branch
 * (returning custody to the original funder after the CLTV gate). The
 * fold itself does NOT reveal a card face; the encryption layer of the
 * concealed object is preserved by the script not requiring a face
 * preimage on the surrendered output.
 */

import type { BlockHeight, Pubkey33 } from '@cardtable/protocol-types';
import { OP } from './opcodes.js';
import { ScriptWriter } from './writer.js';

export interface FoldSurrenderParams {
  readonly original_funder_pubkey: Pubkey33;
  readonly recovery_height: BlockHeight;
}

export function buildFoldSurrenderScript(p: FoldSurrenderParams): Uint8Array {
  const w = new ScriptWriter();
  // The surrendered output's only spendable path is CLTV recovery to the
  // original funder. No reveal branch is offered — folds are final, and
  // no party should benefit from the surrendered output before the
  // recovery window.
  w.pushNumber(p.recovery_height);
  w.op(OP.OP_CHECKLOCKTIMEVERIFY);
  w.op(OP.OP_DROP);
  w.pushPubkey(p.original_funder_pubkey);
  w.op(OP.OP_CHECKSIG);
  return w.bytes();
}
