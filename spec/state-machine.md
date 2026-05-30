# Spec: State Machine

> **Status:** authoritative. The TypeScript and Go state-engine implementations
> must match this document and the test vectors at `spec/test-vectors/`.
> When prose and a test vector disagree, the vector wins (per ADR-000).

## 1. Scope

This document specifies the In-Between (Acey-Deucey) state machine in full.
Every state class, every legal transition, every successor template, and
every default-on-silence consequence is enumerated.

## 2. Notation

- **State class** — a category of states with the same transition rules
  (e.g. `BET_DECISION`).
- **State instance** — a specific committed state, identified by its
  canonical `stateHash`.
- **Successor template** — the canonical pattern for a transaction that
  spends the state's action-right output.
- **Decision deadline** — relative-locktime delta in blocks, applied to
  the spending transaction's input `nSequence`. The timeout-default tx
  becomes valid after this many blocks have elapsed since the locking
  output's confirmation.
- **Recovery deadline** — absolute block height, applied to the spending
  transaction's `nLockTime`. The recovery tx becomes valid at or after
  this height.
- All locktimes use block-height semantics (`nLockTime < 5e8`); per-second
  semantics are out of scope for v1.

## 3. State classes

| Code | Class | Acting party | Decision timeout | Default on silence | Recovery? |
|---|---|---|---|---|---|
| `S0` | `TABLE_OPEN` | operator | — | — | — |
| `S1` | `SEAT_OPEN` | any prospective player | invitation_window | none (table never locks) | — |
| `S2` | `TABLE_LOCKED` | all seated players | — | — | yes |
| `S3` | `ENTROPY_COMMIT_WINDOW` | each seated player | `decision_timeout` | exclusion from shuffle | yes |
| `S4` | `ENTROPY_REVEAL_WINDOW` | each committed player | `decision_timeout` | penalty per `RuleSet.penalty_schedule.non_reveal` | yes |
| `S5` | `DECK_COMMITTED` | quorum | — | — | yes |
| `S6` | `CARD_REVEAL_FIRST` | any (deterministic from deck) | `decision_timeout` | recovery (no progress possible) | yes |
| `S7` | `CARD_REVEAL_SECOND` | any (deterministic from deck) | `decision_timeout` | recovery | yes |
| `S8` | `BET_DECISION` | one acting player | `decision_timeout` | **pass** (no bet) | yes |
| `S9` | `CARD_REVEAL_THIRD` | any (deterministic from deck) | `decision_timeout` | recovery | yes |
| `S10` | `SETTLED_ROUND` | quorum | `decision_timeout` | auto-settle from committed reveals | yes |
| `S11` | `ROTATE_TURN` | quorum | — | — | yes |
| `S12` | `TABLE_CLOSE` | all seated players | — | — | yes |
| `R` | `RECOVERY` | any | — | — | self |

Only state classes `S0`, `S1`, and `S12` have no `RECOVERY` branch. `S0`
predates funding; `S1` has invitation-window timeout but no value at risk
beyond unspent operator funding; `S12` is the terminal state.

## 4. Transition table

The transitions are written as `current_class -> { on_action: next_class, on_silence: next_class }`.

```
S0  TABLE_OPEN          ->  on TableOpen accepted: S1
S1  SEAT_OPEN           ->  on Join (seat_count_met): S2
                            on Join (seat_count_partial): S1 (loop)
                            on invitation_window_expired: closed-empty (no value at risk)
S2  TABLE_LOCKED        ->  on TableLock: S3
S3  ENTROPY_COMMIT      ->  on every-player EntropyCommit: S4
                            on missing EntropyCommit after timeout: R (recovery: abort, refund seated stakes)
S4  ENTROPY_REVEAL      ->  on every-player EntropyReveal: S5
                            on missing EntropyReveal after timeout: R (recovery: penalise non-revealer, refund others)
S5  DECK_COMMITTED      ->  on DeckCommit: S6
S6  CARD_REVEAL_FIRST   ->  on CardReveal_1: S7
                            on absent CardReveal_1 after timeout: R
S7  CARD_REVEAL_SECOND  ->  on CardReveal_2: S8
                            on absent CardReveal_2 after timeout: R
S8  BET_DECISION        ->  on BetAction with valid amount: S9
                            on Pass: S11
                            on Timeout (silence past decision_timeout): S11 (as if Pass)
S9  CARD_REVEAL_THIRD   ->  on CardReveal_3: S10
                            on absent CardReveal_3 after timeout: R
S10 SETTLED_ROUND       ->  on Settle: S11
                            on absent Settle after timeout: R (auto-settle path attempts S11 first; fails to R only if Settle invalid)
S11 ROTATE_TURN         ->  on RotateTurn (next player): S6 (new round, new acting player)
                            on RotateTurn (last player completed): S12
S12 TABLE_CLOSE         ->  on TableClose: closed
R   RECOVERY            ->  on Recovery: closed-recovered
```

## 5. State object

Every state's committed UTXO carries a canonical state object. The full
field list is in `protocol-types.RoundState` (and `BaseState` for non-round
states). At minimum every state object commits to:

- `gameId` — hash of the `TableOpen` outpoint
- `ruleSetHash` — the rule-set the entire session is bound to
- `stateClass` — one of the codes in §3
- `roundNumber` — 0 for pre-S8 states; increments at each `S11 -> S6`
- `actingPlayerSeat` — seat index of the party owed an action at this state
  (or `null` for quorum / deterministic states)
- `successorTemplateHashes` — sorted set of canonical successor template
  hashes, identifying which transitions are legal from this state
- `decisionDeadline` — block height after which the timeout branch becomes
  valid (or `null` for states without a decision timeout)
- `recoveryDeadline` — absolute block height after which the recovery
  branch becomes valid (or `null` for pre-funding states)
- `priorStateHash` — `stateHash` of the parent state in the transition tree
- `stateHash` — domain-separated hash of the canonical serialisation of the
  state object minus this field

## 6. Determinism

Two honest clients that observe the same sequence of confirmed transactions
must compute identical state objects byte-for-byte. This is enforced by:

1. The canonical serialisation rules in `spec/serialisation.md`.
2. The ordering rules in `spec/ordering-rules.md`.
3. The replay procedure in §7.
4. The test vectors at `spec/test-vectors/`.

A `state-engine` implementation that produces different bytes for the same
inputs has a bug.

## 7. Replay procedure

```
ReplayTranscript(transcript, ruleSet):
  state = InitialState(gameId = transcript.gameId, ruleSetHash = hash(ruleSet))
  for tx in transcript.transactions (in canonical order):
    if not isValidTransition(state, tx, ruleSet): raise InvalidReplay
    state = applyTransition(state, tx, ruleSet)
  return state
```

`isValidTransition` and `applyTransition` are total functions over
`(state, tx, ruleSet)`. They are pure: no I/O, no hidden state, no clock.

## 8. Edge cases (binding, not exhaustive)

- **Reorg of confirmed transactions.** Replay restarts from the deepest
  unaffected confirmed state. The relay and indexer must surface a reorg
  event; the state-engine itself is reorg-agnostic — it computes from
  whatever transaction set it is given.
- **Conflicting unconfirmed transactions for the same state.** The state
  engine accepts the first valid one passed to `applyTransition`. The
  caller (relay / client) is responsible for choosing per
  `spec/ordering-rules.md`.
- **Out-of-order transcript replay.** Replay rejects any transaction whose
  `priorStateHash` does not match the engine's current state hash.
- **Unknown serialisation version.** Replay rejects rather than guessing.
  Recovery branch becomes the only available exit (per PROJECT_SPEC.md §10).

## 9. Conformance

A state-engine implementation conforms to this spec iff:

1. For every test vector in `spec/test-vectors/`, the implementation
   produces the exact `expected_state` and `expected_transactions`.
2. No internal state survives between `replay()` calls (purity).
3. The implementation rejects every entry in `spec/test-vectors/`
   marked `expected_error` with the exact error code listed.

Both the TypeScript engine (`packages/state-engine`) and the Go engine
(`apps/relay-go/pkg/engine`) must conform.
