# Spec: Recovery Rules

> **Status:** authoritative. Aligns with Formal Architecture §2.5.2 (Global
> recovery timeout) and §4 (Threat Model).

## 1. Recovery is the unconditional safety net

Every locked output in this protocol has a recovery branch. There is no
output that requires cooperation to release; if every other participant
disappears, the original funder of value recovers their value after the
recovery timeout matures (per `spec/script-templates.md`).

## 2. Triggers

The recovery transaction `TXC_RECOVERY` becomes valid when the
session's absolute recovery deadline matures — i.e. when the spending tx's `nLockTime` field is at or below the current block height. It is broadcast by
any participant (or by a watchtower; out of scope for v1). It consumes
the deepest unsettled state output along the cooperative chain.

Recovery is triggered when at least one of the following holds:

- The decision-timeout chain has fired N consecutive times without
  progress (`N >= 2` is the v1 default; the rule set may override).
- The session has exceeded `recovery_timeout` absolute blocks since
  `TableOpen` confirmed.
- A cryptographic proof failure occurs that cannot be remediated
  in-protocol (e.g. an entropy reveal whose plaintext does not match
  the commitment, and no alternative reveal arrives).

## 3. Distribution rules (default)

In the absence of a `RuleSet.recovery_rules` override:

1. The pot output, if it carries non-zero value, is distributed to
   players in the proportions of their **contributions** to the pot
   (recorded in the pot output's `OP_RETURN` metadata at each
   contribution).
2. Each player-stake output is refunded to its original funder.
3. The fee pool's remaining balance is refunded to the operator.
4. Penalties apply per `RuleSet.penalty_schedule` for parties that
   caused the stall, in order:
   - non-revealer of entropy: `penalty_schedule.non_reveal` deducted
     from their refund and split equally among the other players.
   - non-revealer of a deal-time card: same as above.
   - non-actor at a betting decision: no penalty (silence at
     `BET_DECISION` is the legitimate default `pass`).
   - cryptographic-proof failure: `penalty_schedule.bad_reveal` deducted
     and split among other players.

## 4. Pre-signed recovery graph

At session start, every seated player signs a recovery transaction for
each plausible stall point. These pre-signed transactions:

- Reference each plausible stalled state's recovery-branch output.
- Distribute value per §3.
- Carry `nLockTime = session_start + recovery_timeout_blocks` (the
  session's absolute recovery height); consensus rejects them before
  that height. **No in-script timelock opcode is used.**
- Are stored peer-to-peer and in the `AuditTranscript`.

## 5. Recovery and concealed cards

In the extended one-UTXO-per-card model (Phase 4+), recovery must not
reveal concealed cards held by non-recovering parties. The recovery
transaction consumes `card-custody` outputs via their **recovery
branch**, which uses the original funder's signature alone and does not
require the card face to be revealed (per
`spec/script-templates.md` §2.5). The cards' faces remain encrypted
and unrecoverable after recovery, which is acceptable: the cards have
zero out-of-session value.

This is one of the open proof obligations (PROJECT_SPEC.md §Open Proof
Obligations item 3).

## 6. Conformance

A recovery-rules implementation conforms to this spec iff:

1. Given a `RuleSet`, a session's contribution history, and the
   current set of unsettled outputs, it produces the exact recovery
   transaction the spec mandates.
2. It computes `penalty` deductions per `RuleSet.penalty_schedule`
   identical to the test vectors at `spec/test-vectors/recovery.json`.
3. It signs the recovery graph at session start and stores the
   pre-signed transactions in the transcript.
