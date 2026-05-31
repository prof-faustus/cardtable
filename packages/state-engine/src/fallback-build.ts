/**
 * Bridge between the protocol-level fallback graph enumeration and
 * the BSV-side `@cardtable/script-templates` builders.
 *
 * The orchestrator at session start:
 *   1. Walks the state machine, calling `enumerateFallbackGraph`
 *      at every state.
 *   2. Provides a `BuildContext` with the keys, template hashes, and
 *      deadline values needed to materialise each branch's locking
 *      script.
 *   3. Calls `materialiseFallbackGraph(branches, ctx)` to get back
 *      `BuiltFallbackBranch[]` — one locking script + LockTimeSpec
 *      per branch — ready for the downstream tx builder to wrap in
 *      a pre-signed transaction.
 *
 * This module is the integration point, not the BSV construction
 * itself. The actual script bytes come from `@cardtable/script-templates`.
 */

import type { BlockHeight, Hash256, Pubkey33 } from '@cardtable/protocol-types';
import {
  buildRecoveryBranchTemplate,
  buildTimeoutBranch,
  type LockTimeSpec as ScriptLockTimeSpec,
} from '@cardtable/script-templates';
import type { FallbackBranch } from './fallback.js';

/**
 * Per-branch context the orchestrator supplies when materialising
 * the fallback graph. All fields are required because silent
 * defaults are a binding hazard (PROJECT_SPEC.md §Coding Standards).
 */
export interface BuildContext {
  readonly decision_timeout_blocks: number;
  readonly recovery_height: BlockHeight;
  /** Authoriser pubkeys whose n-of-n multisig signs the timeout tx. */
  readonly timeout_authorisers: readonly Pubkey33[];
  /** Domain-separated commitment to the timeout-template body. */
  readonly timeout_template_hash: Hash256;
  /** The signer pubkey whose CHECKSIG unlocks the recovery branch. */
  readonly recovery_signer: Pubkey33;
}

/** A materialised branch carries the locking script and its timing. */
export interface BuiltFallbackBranch {
  readonly branch: FallbackBranch;
  readonly locking_script: Uint8Array | null;
  readonly locktime: ScriptLockTimeSpec | null;
}

/**
 * Materialise every enumerated branch into BSV locking-script bytes
 * via the existing script-template builders. Cooperative branches
 * are left as `locking_script: null` for now — the cooperative
 * locking scripts depend on the specific state class and are
 * produced by the per-state script builders (table-root, stake-lock,
 * round-state, etc.) rather than by a single bridge function.
 */
export function materialiseFallbackGraph(
  branches: readonly FallbackBranch[],
  ctx: BuildContext,
): readonly BuiltFallbackBranch[] {
  return branches.map((b) => {
    switch (b.kind) {
      case 'timeout': {
        const built = buildTimeoutBranch({
          decision_timeout_blocks: ctx.decision_timeout_blocks,
          timeout_template_hash: ctx.timeout_template_hash,
          authoriser_pubkeys: ctx.timeout_authorisers,
        });
        return { branch: b, locking_script: built.locking_script, locktime: built.locktime };
      }
      case 'recovery': {
        const built = buildRecoveryBranchTemplate({
          recovery_height: ctx.recovery_height,
          signer_pubkey: ctx.recovery_signer,
        });
        return { branch: b, locking_script: built.locking_script, locktime: built.locktime };
      }
      case 'cooperative':
        // Cooperative branches use per-state templates; the bridge
        // does not produce them here.
        return { branch: b, locking_script: null, locktime: null };
    }
  });
}
