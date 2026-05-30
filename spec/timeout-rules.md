# Spec: Timeout Rules

> **Status:** authoritative. Aligns with Formal Architecture §2.5 (Timeout
> Model) and CLAUDE.md §Timeout Matrix.

## 1. The general rule

Every actionable state has both a cooperative branch and a dead-man
(default) branch. Silence past the decision deadline is **not** an error;
it is a defined event that activates the default. The dead-man branch is
gated by `OP_CHECKSEQUENCEVERIFY` (relative locktime since state
established). Every session additionally has a global `RECOVERY` branch
gated by `OP_CHECKLOCKTIMEVERIFY` (absolute height fixed at session
start).

## 2. Timeout matrix

| State class | Decision timeout | Default consequence on silence | Recovery timeout | Recovery consequence |
|---|---|---|---|---|
| `S1 SEAT_OPEN` | `invitation_window` | table never locks; operator may reclaim fee pool after recovery | `recovery_timeout` | refund operator fee pool; no player value at risk yet |
| `S3 ENTROPY_COMMIT` | `decision_timeout` | non-committer is excluded from shuffle; if quorum still met, play continues | `recovery_timeout` | abort, refund all seated stakes |
| `S4 ENTROPY_REVEAL` | `decision_timeout` | non-revealer is penalised per `RuleSet.penalty_schedule.non_reveal`; others refunded | `recovery_timeout` | abort, distribute per `recovery_rules` |
| `S6, S7, S9 CARD_REVEAL_*` | `decision_timeout` | structural stall; cannot continue (the reveal is deterministic from deck commitment + opening proofs) | `recovery_timeout` | refund all seated stakes, apply non-cooperation penalties |
| `S8 BET_DECISION` | `decision_timeout` | **pass** (no bet, no economic change) | `recovery_timeout` | recovery unwind |
| `S10 SETTLED_ROUND` | `decision_timeout` | auto-settle from committed reveals (deterministic from `RuleSet.settlement_rules`) | `recovery_timeout` | recovery unwind |
| `S11 ROTATE_TURN` | — | — | `recovery_timeout` | recovery unwind (the rotate is administrative; absence triggers global recovery) |

Concrete values for `decision_timeout` and `recovery_timeout` are set in
the `RuleSet` and committed at session start. Reference defaults for
In-Between v1:

- `decision_timeout` = 6 blocks (~60 minutes mainnet, near-instant on
  regtest with manual mining)
- `recovery_timeout` = 144 blocks (~24 hours mainnet)
- `invitation_window` = 18 blocks (~3 hours mainnet)

These are recommended defaults, not enforced minima; operators may
configure stricter or looser values per game style.

## 3. Two-deadline interaction

For any state both deadlines may be active simultaneously:

```
t_0 = state established (relative locktime base)
t_decision = t_0 + decision_timeout_blocks   (CSV-relative)
t_recovery = session_start + recovery_timeout_blocks   (CLTV-absolute)
```

If `t_decision < t_recovery`, the decision-timeout branch is the
first-spendable failure path; the recovery branch is the deeper safety
net. Operators must set parameters such that `t_decision < t_recovery`
for every state. The state engine validates this when applying
`RuleSet`; mis-configured rule sets are rejected at `TableOpen`.

## 4. Conflict between cooperative and timeout

Once the cooperative branch is spent (an in-time `BetAction`, `Pass`,
`Reveal`, `Settle`, etc.), the corresponding timeout transaction cannot
be confirmed: the input it claims to spend is gone. This is enforced by
BSV consensus (single-spend), not by protocol logic.

Conversely, once the timeout branch is spent, an in-time but
late-arriving cooperative transaction is invalid for the same reason.

The window in which **both** are simultaneously valid is precisely the
moment the decision deadline matures **and** the cooperative transaction
has not yet been confirmed. In that window, mempool first-seen-by-quorum
resolves; on conflict, `spec/ordering-rules.md` §3 defines the
deterministic rule the indexer applies.

## 5. Decision-timeout activation

A decision-timeout transaction (`TXC_TIMEOUT`) is broadcast by **any**
participant. The state engine treats the timeout transaction as a
distinct successor class, not as a copy of the default cooperative
action; the timeout transaction's `OP_RETURN` metadata names which
seat fell silent and what the default consequence is.

For `S8 BET_DECISION`, the default is `pass`. The timeout transaction
records `actingPlayerSeat = silenced_seat`, `defaultAction = "pass"`,
and produces a round-state output identical to what `TXC_PASS` from the
silenced seat would have produced.

## 6. Recovery activation

Recovery is **the only safe exit** when a session cannot make progress
along any cooperative path. Triggers (non-exhaustive):

- Repeated decision timeouts at non-decision states (e.g. nobody can
  broadcast the deterministic `CardReveal_1` because the deck commitment
  is inaccessible).
- Total partition: no participant can communicate with any other.
- Fee-pool exhaustion mid-session.
- Cryptographic protocol failure (e.g. a reveal proof fails verification
  and no alternative reveal is forthcoming).

The recovery transaction `TXC_RECOVERY` consumes the deepest unsettled
state output along the cooperative chain (CLTV-gated). Its outputs
distribute value per `RuleSet.recovery_rules`; the default rule for
In-Between v1 is **refund every seated stake to its original funder**,
less any penalties named in `RuleSet.penalty_schedule`.

## 7. Pre-signed fallback graph

At session start (immediately after `TableLock`), every seated player
signs the **complete fallback graph** of transactions:

1. `Recovery` against the deepest plausible stall point of every
   actionable state in the session's expected trajectory.
2. `Timeout` against every actionable state in the trajectory.
3. Aborts against pre-funding stalls.

The pre-signed transactions are stored in `AuditTranscript` and
distributed peer-to-peer; any participant may broadcast them when the
relevant deadline matures. This is the mechanism that makes "silence is
a defined event" enforceable: even if the timed-out party also refuses
to broadcast the timeout transaction, the other participants already
hold a valid pre-signed copy.

## 8. Conformance

A timeout-rules implementation conforms to this spec iff:

1. For every state, it can compute the exact decision-deadline block
   height from `t_0` and `decision_timeout_blocks`.
2. For every state, it can compute the exact recovery-deadline block
   height from `session_start` and `recovery_timeout_blocks`.
3. It rejects rule sets where `decision_timeout >= recovery_timeout`.
4. Given a `RoundState` and a `current_block_height`, it returns
   `{ canCooperate: bool, canTimeout: bool, canRecover: bool }`
   matching the cases above exactly.
