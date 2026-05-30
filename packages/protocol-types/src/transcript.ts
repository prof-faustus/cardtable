/**
 * AuditTranscript — full signed message stream for a session.
 *
 * The transcript is what an
 * independent auditor uses to replay the session deterministically.
 */

import type { Hash256, TxId } from './primitives.js';
import type { SignedAction } from './actions.js';
import type { RevealProof } from './cards.js';
import type { SettlementResult, RecoveryRecord } from './settlement.js';

/** One row in the transcript. */
export type TranscriptEntry =
  | { readonly kind: 'state_committed'; readonly state_hash: Hash256 }
  | { readonly kind: 'signed_action'; readonly action: SignedAction; readonly txid: TxId }
  | { readonly kind: 'reveal_proof'; readonly proof: RevealProof; readonly txid: TxId }
  | { readonly kind: 'timeout_activation'; readonly state_hash: Hash256; readonly txid: TxId }
  | { readonly kind: 'settlement'; readonly result: SettlementResult; readonly txid: TxId }
  | { readonly kind: 'recovery'; readonly record: RecoveryRecord; readonly txid: TxId };

/**
 * Total ordered audit transcript for one session. The entries are
 * canonically ordered per `spec/ordering-rules.md` §2:
 *
 * 1. by the state_hash they reference,
 * 2. by acting-player seat index,
 * 3. by action nonce,
 * 4. by txid as final tie-breaker.
 */
export interface AuditTranscript {
  readonly entries: readonly TranscriptEntry[];
}
