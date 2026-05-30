# Spec: Timeout Rules

> **Status:** authoritative.

## 1. The general rule

Every actionable state has both a cooperative branch and a dead-man
(default) branch. Silence past the decision deadline is **not** an
error; it is a defined event that activates the default.

**Timing is enforced at the spending transaction level.** Every
time-gated transaction (timeout-default, recovery) is **pre-signed at
session start** with its `nLockTime` (absolute deadline) or its input
`nSequence` (relative-locktime delta since the locking output was
confirmed) set to the required value. Consensus rejects these
transactions before their gates mature. **No locking script in the
protocol uses an in-script timelock opcode.**

## 2. Timeout matrix

| State class | Decision timeout | Default consequence on silence | Recovery timeout | Recovery consequence |
|---|---|---|---|---|
| `S1 SEAT_OPEN` | `invitation_window` | table never locks; operator may reclaim fee pool after recovery | `recovery_timeout` | refund operator fee pool; no player value at risk yet |
| `S3 ENTROPY_COMMIT` | `decision_timeout` | non-committer excluded from shuffle; if quorum still met, play continues | `recovery_timeout` | abort, refund all seated stakes |
| `S4 ENTROPY_REVEAL` | `decision_timeout` | non-revealer penalised per `RuleSet.penalty_schedule.non_reveal`; others refunded | `recovery_timeout` | abort, distribute per `recovery_rules` |
| `S6, S7, S9 CARD_REVEAL_*` | `decision_timeout` | structural stall — cannot continue (the reveal is deterministic from deck commitment + opening proofs) | `recovery_timeout` | refund seated stakes; apply non-cooperation penalties |
| `S8 BET_DECISION` | `decision_timeout` | **pass** (no bet, no economic change) | `recovery_timeout` | recovery unwind |
| `S10 SETTLED_ROUND` | `decision_timeout` | auto-settle from committed reveals | `recovery_timeout` | recovery unwind |
| `S11 ROTATE_TURN` | — | — | `recovery_timeout` | recovery unwind |

Concrete defaults (set in the `RuleSet` and committed at session
start):

- `decision_timeout = 6 blocks`
- `recovery_timeout = 144 blocks`
- `invitation_window = 18 blocks`

## 3. Two-deadline interaction

For any state both deadlines may be active:

```
t_0       = state established (relative-locktime base)
t_decision = t_0 + decision_timeout_blocks                  (input nSequence)
t_recovery = session_start + recovery_timeout_blocks         (tx nLockTime)
```

Operators must set parameters such that `t_decision < t_recovery` for
every state. The state engine validates this when applying the
`RuleSet`; mis-configured rule sets are rejected at `TableOpen`.

## 4. Conflict between cooperative and timeout

Once the cooperative branch is spent, the corresponding timeout
transaction cannot be confirmed: the input it claims to spend is
gone. Conversely, once the timeout branch is spent, an in-time but
late-arriving cooperative transaction is invalid for the same
reason. This is enforced by BSV consensus (single-spend), not by
protocol logic.

The narrow window in which both are simultaneously valid — the
moment the decision deadline matures and the cooperative tx has not
yet confirmed — is resolved by `spec/ordering-rules.md` §3.

## 5. Decision-timeout activation

A decision-timeout transaction is broadcast by **any** participant
once the input's relative-locktime gate matures. Its `OP_RETURN`
metadata names which seat fell silent and what the default
consequence was. The transaction is **pre-signed at session start**
by the seated quorum so any participant can broadcast it.

For `S8 BET_DECISION`, the default is `pass`. The timeout transaction
produces a round-state output identical to what a `Pass` from the
silenced seat would have produced; the pot is unchanged.

## 6. Recovery activation

Recovery is the only safe exit when a session cannot make progress
along any cooperative path. Triggers (non-exhaustive):

- Repeated decision timeouts at non-decision states.
- Total partition.
- Fee-pool exhaustion mid-session.
- Cryptographic proof failure that cannot be remediated in-protocol.

The recovery transaction's `nLockTime = session_start +
recovery_timeout_blocks`; consensus rejects it before that height.
Outputs distribute value per `RuleSet.recovery_rules`.

## 7. Pre-signed fallback graph

At session start (immediately after `TableLock`), every seated
player signs every fallback transaction:

1. `Recovery` against the deepest plausible stall point of every
   actionable state in the session's expected trajectory.
2. `Timeout` against every actionable state in the trajectory.
3. Aborts against pre-funding stalls.

The pre-signed transactions are stored in `AuditTranscript` and
distributed peer-to-peer; any participant may broadcast them when
the relevant gate matures.

## 8. Conformance

A timeout-rules implementation conforms to this spec iff:

1. For every state, it can compute the exact decision-deadline block
   height from `t_0` and `decision_timeout_blocks`.
2. For every state, it can compute the exact recovery-deadline block
   height from `session_start` and `recovery_timeout_blocks`.
3. It rejects rule sets where `decision_timeout >= recovery_timeout`.
4. Given a `RoundState` and a `current_block_height`, it returns
   `{ canCooperate, canTimeout, canRecover }` matching the rules
   above exactly.
5. **No transaction it produces or accepts uses an in-script
   timelock opcode.**
