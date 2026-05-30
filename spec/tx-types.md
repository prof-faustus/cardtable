# Spec: Transaction Types

> **Status:** authoritative. Aligns with Formal Architecture §5 (Transaction
> Model). Every transaction class below has a canonical template, a binding
> field set, and a position in the state machine of `spec/state-machine.md`.

## 1. Transaction classes (In-Between v1)

| Code | Class | Consumes | Produces | Locktime gate |
|---|---|---|---|---|
| `TXC_TABLE_OPEN`     | `TableOpen` | operator funding UTXO | open table-root + fee pool | — |
| `TXC_JOIN`           | `Join` | player funding UTXO | player-stake + updated open table-root | — |
| `TXC_TABLE_LOCK`     | `TableLock` | open table-root | locked table-root (commits player list + turn order) | — |
| `TXC_ENTROPY_COMMIT` | `EntropyCommit` | player signing input | entropy-commitment output (per player) | — |
| `TXC_ENTROPY_REVEAL` | `EntropyReveal` | entropy-commitment output | revealed-entropy marker (per player) | — |
| `TXC_DECK_COMMIT`    | `DeckCommit` | locked table-root + all revealed-entropy markers | deck-commitment output | — |
| `TXC_CARD_REVEAL`    | `CardReveal` | deck-commitment output (or prior round-state) | round-state output with one more visible card recorded | — |
| `TXC_BET_ACTION`     | `BetAction` | round-state output (action-right branch) | round-state output with bet recorded | — |
| `TXC_PASS`           | `Pass` | round-state output (action-right branch) | round-state output with pass recorded | — |
| `TXC_TIMEOUT`        | `Timeout` | round-state output (timeout branch) | round-state output with default consequence recorded | **CSV** (relative, since state established) |
| `TXC_SETTLE`         | `Settle` | round-state output + pot output | updated pot output + per-player balance outputs | — |
| `TXC_ROTATE_TURN`    | `RotateTurn` | settled round-state output | next round-state output with next acting player | — |
| `TXC_RECOVERY`       | `Recovery` | stalled state output (recovery branch) | refund outputs per recovery-rules | **CLTV** (absolute, session-wide) |
| `TXC_TABLE_CLOSE`    | `TableClose` | terminal table-root output | final per-player balance outputs | — |
| `TXC_FOLD`           | `Fold` | concealed-hand custody output (extended deck model) | dead-hand surrender output | — |

Note: `TXC_FOLD` is reserved for the extended one-UTXO-per-card model
(Phase 4+). In-Between v1 (Phase 5) does not use it — In-Between reveals
all three cards publicly and has no concealed private hand to fold.

## 2. Binding fields

Every transaction in §1 commits, either directly in `OP_RETURN`-anchored
metadata or indirectly through the script it satisfies, to the following
fields (definitions in `spec/serialisation.md`):

- `gameId` — hash of the `TableOpen` outpoint
- `ruleSetHash` — SHA-256 of the canonical-serialised `RuleSet`
- `roundNumber` — `0` for pre-S8; incremented at each `RotateTurn`
- `referencedStateHash` — the `stateHash` of the parent state being spent
- `actingPlayerSeat` — seat index of the acting party (where applicable)
- `economicState` — pot value + per-seat balances after this transition
- `visibleCardsSnapshot` — ordered list of revealed plaintext cards in this round
- `hiddenCommitmentRefs` — references to deck-position commitments not yet opened
- `successorStateCommitment` — `stateHash` of the state this tx produces

A transaction that fails to bind one or more of the above is invalid per
the script layer.

## 3. Anchoring binding fields

Two patterns are permitted; both are normative.

**Pattern A — `OP_RETURN`-anchored.** A single `OP_RETURN <metadata>`
output carrying the canonical serialisation of the binding fields. This
is the default and used by every class above.

**Pattern B — Script-embedded.** The binding fields are committed inside
the locking script of the produced state output (via `OP_HASH256
<binding_hash> OP_EQUALVERIFY`-style preconditions in the cooperative
branch). Used when an `OP_RETURN` output would exceed the policy data
budget, which on post-Genesis BSV is generous; in practice Pattern A
suffices.

## 4. Class definitions

For each class below: **consumes**, **produces**, **locktime**, **binding
fields**, and any class-specific notes.

### 4.1 `TXC_TABLE_OPEN` — TableOpen

- **Consumes:** operator funding UTXO (one or more P2PKH inputs at the
  operator's discretion).
- **Produces:**
  - Output 0 — open table-root, value `0` satoshis,
    locked under the `table-root` template (see
    `spec/script-templates.md` §`table-root`).
  - Output 1 — fee pool, value `feePoolFundingSats`, locked under a
    cooperative-or-recover script paying the operator on `TableClose`.
  - Output 2 — `OP_RETURN` metadata (Pattern A binding).
- **Locktime:** none.
- **Binding fields:** all of §2 with `roundNumber = 0`,
  `referencedStateHash = null`, `economicState = { pot: 0, balances: [] }`.

### 4.2 `TXC_JOIN` — Join

- **Consumes:** player funding UTXO + (in extended chain mode) the current
  open table-root. v1 SIMPLIFIED: Join is a parallel-style commitment that
  references the open table-root by `referencedStateHash` in metadata but
  does not consume it; the open table-root is consumed once by
  `TXC_TABLE_LOCK`. This avoids a serialised join queue.
- **Produces:**
  - Output 0 — player-stake, value `RuleSet.stake_amount` satoshis,
    locked under `stake-lock` (cooperative-or-winner-or-refund).
  - Output 1 — `OP_RETURN` metadata.
- **Locktime:** none.
- **Binding:** `referencedStateHash` = `stateHash` of current open
  table-root (or hash of `TableOpen` outpoint for the first join).
  `actingPlayerSeat` = the seat the player is claiming.

### 4.3 `TXC_TABLE_LOCK` — TableLock

- **Consumes:** open table-root output + all `player-stake` outputs
  (one per seated player, as cooperative-branch witnesses or via
  multi-input).
- **Produces:**
  - Output 0 — locked table-root committing the final seated player list,
    canonical turn order, and a pointer to each `player-stake` outpoint.
  - Output 1 — `OP_RETURN` metadata.
- **Locktime:** none.
- **Required signatures:** every seated player (n-of-n) on the locked
  table-root's metadata commitment.

### 4.4 `TXC_ENTROPY_COMMIT` — EntropyCommit

- **Consumes:** the player's own signing input (a small fee-paying UTXO
  outside the game; this transaction does not consume any locked output).
- **Produces:**
  - Output 0 — entropy-commitment output, value `0` satoshis, locked
    under `entropy-commit` template containing `H(entropy || playerId
    || gameId)`. Spendable only by `TXC_ENTROPY_REVEAL`.
  - Output 1 — `OP_RETURN` metadata.
- **Locktime:** none.

### 4.5 `TXC_ENTROPY_REVEAL` — EntropyReveal

- **Consumes:** entropy-commitment output (cooperative branch).
- **Produces:**
  - Output 0 — revealed-entropy marker (binary equality with the
    committed hash is verified inside the unlocking script).
  - Output 1 — `OP_RETURN` metadata carrying the opened entropy.
- **Locktime:** none. Reveal-window timing is enforced by the **timeout
  branch** of the entropy-commitment output itself (CSV-gated), not by
  this class.

### 4.6 `TXC_DECK_COMMIT` — DeckCommit

- **Consumes:** locked table-root + every revealed-entropy marker.
- **Produces:**
  - Output 0 — deck-commitment output, committing
    `H(combined_entropy || shuffle_algorithm_version)` and the full
    shuffled deck commitment.
  - Output 1 — `OP_RETURN` metadata.
- **Locktime:** none.

### 4.7 `TXC_CARD_REVEAL` — CardReveal

- **Consumes:** deck-commitment output (for the first reveal of a round)
  OR the prior round-state output (for subsequent reveals in the same
  round).
- **Produces:**
  - Output 0 — round-state output carrying the additional revealed card.
  - Output 1 — `OP_RETURN` metadata + reveal proof binding the revealed
    plaintext to the deck commitment.
- **Locktime:** none for the cooperative branch; the prior state's
  timeout branch (CSV-gated) is the failure path.

### 4.8 `TXC_BET_ACTION` — BetAction

- **Consumes:** round-state output (action-right cooperative branch).
- **Produces:**
  - Output 0 — round-state output with the bet recorded in metadata
    (bet amount, acting player, successor state commitment).
  - Output 1 — pot output incremented by the bet amount.
  - Output 2 — `OP_RETURN` metadata.
- **Locktime:** none. (Decision timeout is the parallel branch of the
  consumed output.)

### 4.9 `TXC_PASS` — Pass

- **Consumes:** round-state output (action-right cooperative branch).
- **Produces:**
  - Output 0 — round-state output with the pass recorded.
  - Output 1 — `OP_RETURN` metadata.
- **Locktime:** none.

### 4.10 `TXC_TIMEOUT` — Timeout

- **Consumes:** round-state output (timeout branch).
- **Produces:**
  - Output 0 — round-state output with default consequence recorded
    (pass for `S8 BET_DECISION` in In-Between v1).
  - Output 1 — `OP_RETURN` metadata identifying the silenced acting
    player and the default action applied.
- **Locktime:** `RuleSet.decision_timeout_blocks` relative blocks since
  the consumed state was established (CSV).

### 4.11 `TXC_SETTLE` — Settle

- **Consumes:** round-state output (settle-ready cooperative branch)
  AND the pot output.
- **Produces:**
  - Output 0 — updated pot output (post-settlement balance).
  - Outputs 1..n — per-player balance outputs (P2PKH to each player's
    `value_signing_pubkey` for the amount won or refunded).
  - Output n+1 — `OP_RETURN` metadata.
- **Locktime:** none.

### 4.12 `TXC_ROTATE_TURN` — RotateTurn

- **Consumes:** settled round-state output (cooperative or auto-settle
  branch).
- **Produces:**
  - Output 0 — next round-state output for the next seat in canonical
    turn order; or if the round was the last in the table, a terminal
    table-root output.
  - Output 1 — `OP_RETURN` metadata.
- **Locktime:** none.

### 4.13 `TXC_RECOVERY` — Recovery

- **Consumes:** the deepest unsettled committed state output along the
  cooperative chain (recovery branch).
- **Produces:**
  - Outputs 0..k — refund / penalty outputs per the
    `RuleSet.recovery_rules`.
  - Output k+1 — `OP_RETURN` metadata + diagnostic record.
- **Locktime:** absolute block height fixed at session start (CLTV).
  Default: `TableOpen` block height + `RuleSet.recovery_timeout_blocks`.

### 4.14 `TXC_TABLE_CLOSE` — TableClose

- **Consumes:** terminal table-root output (cooperative branch).
- **Produces:**
  - Outputs 0..n — final per-player balance outputs.
  - Output n+1 — fee-pool refund to the operator (less consumed fees).
  - Output n+2 — `OP_RETURN` metadata.
- **Locktime:** none.

### 4.15 `TXC_FOLD` — Fold (Phase 4+ only, not used by In-Between v1)

- **Consumes:** the player's concealed-hand custody output(s) (cooperative
  surrender branch).
- **Produces:** dead-hand surrender output preserving encryption.
- **Locktime:** none.
- **MUST NOT:** reveal any card face, leak card identity, or require
  cooperation from other players.

## 5. Fee policy (per Formal Architecture §5.6)

All transaction fees are paid from the operator-funded fee-pool output,
not deducted from player stakes. Each class has a per-class fee budget
specified in the `RuleSet`. Fee-pool exhaustion mid-session triggers the
recovery branch.

## 6. Conformance

A transaction conforms to this spec iff:

1. Its class matches one of §4.
2. Its consumed outputs match the class definition exactly.
3. Its produced outputs match the class definition exactly (counts,
   values, scripts).
4. The binding fields in its `OP_RETURN` metadata canonically serialise
   to the expected hashes referenced by the consumed state's
   `successorTemplateHashes`.
5. Locktime constraints (where applicable) are satisfied.

The state engine rejects any transaction failing the above with the
error code `INVALID_TX_CONFORMANCE`.
