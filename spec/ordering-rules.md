# Spec: Ordering Rules

> **Status:** authoritative. Aligns with Formal Architecture §2.10
> (Canonical ordering and conflict precedence) and §5.7 (Conflict
> resolution).

## 1. Why ordering matters

Two honest clients that observe the same set of confirmed transactions
must compute identical state objects. To do so they must order
unconfirmed and confirmed transactions identically. This spec defines
the **canonical order** for every collection-valued field and the
**precedence rule** for conflicting transactions.

## 2. Collection ordering

Per `spec/serialisation.md` §3 every collection-valued field has a
declared comparator. The relevant cases:

- `players` in `GameInstance` — ordered by ascending `seat_index`.
- `entropy_commitments` in a `DeckCommitment.reveal_history` — ordered by
  ascending seat of the player.
- `signed_actions` in `AuditTranscript` — ordered by (1) referenced
  state hash, (2) acting player seat, (3) action nonce, (4) txid as
  final tie-breaker.
- `successor_template_refs` in `RoundState` — sorted by template hash.

## 3. Transaction conflict precedence

Two unconfirmed transactions that spend the same state output's
**same branch** (e.g. two `BetAction` for the same `S8` state) form a
conflict. The state engine itself does not pick one; it accepts the
first valid one passed to `applyTransition` (it is a pure function).
The **caller** (relay / client) picks per the following rule and then
passes the chosen one to the engine.

### 3.1 Choice rule

Given two conflicting unconfirmed transactions T_A and T_B:

1. If exactly one of T_A, T_B is referenced by a transaction confirmed
   into a BSV block, the referenced one wins. (BSV consensus has
   already chosen.)
2. Otherwise, if exactly one has been observed by **the quorum** (≥
   ⌈(N+1)/2⌉ of seated players) by the moment the decision deadline
   matures, that one wins.
3. Otherwise, the one with the **lexicographically smaller txid** wins.

### 3.2 Across-branch conflict

A cooperative action and a timeout transaction for the same state are
mutually exclusive but are not symmetric:

- The timeout transaction is **invalid** until the decision deadline
  matures — consensus rejects it before its input `nSequence`
  relative-locktime delta has elapsed since the locking output was
  confirmed. Therefore an in-time cooperative action always **legally**
  wins prior to the deadline.
- After the deadline matures, both branches are simultaneously valid
  until one is confirmed. The choice rule of §3.1 then applies; the
  cooperative action keeps a tie-break advantage because it was valid
  earlier.

### 3.3 Stale-action arrival

A cooperative action transaction broadcast after the timeout
transaction has been confirmed is invalid (its input is already spent).
BSV consensus rejects it; no protocol logic is required.

### 3.4 Reconnect with obsolete state

A client that has been offline broadcasts an action referencing an
already-spent state output. BSV consensus rejects it. The reconnecting
client must replay the current canonical transcript before producing a
valid action.

## 4. Mempool eviction

Mempool eviction is observable: a previously-seen transaction stops
appearing. The state engine itself is mempool-agnostic, but the
**relay** is responsible for:

1. Tracking the set of unconfirmed transactions it has previously
   relayed.
2. On detecting eviction (e.g. via `tx_status -> not_in_mempool`
   without a confirmation), re-broadcasting from its persistent store.
3. On exhausting rebroadcast attempts beyond `relay_rebroadcast_max`
   (default 3), surfacing a `RECOVERY_RECOMMENDED` event.

## 5. Reorg handling

Reorgs are handled by the indexer / chain client, not the state engine.
The engine's contract is: "given this transcript, compute this state".
On reorg, the indexer:

1. Identifies the deepest common ancestor between the old and new
   chains.
2. Rewinds the state to that ancestor (replays the engine from the
   shared prefix).
3. Forward-applies the new chain.

The state engine is pure; it has no reorg-specific code path.

## 6. Conformance

An ordering implementation conforms to this spec iff:

1. For every test vector at `spec/test-vectors/double-spend-attempt.json`,
   it selects the same winner the vector specifies.
2. It rejects across-branch conflicts deterministically per §3.2.
3. Its rebroadcast policy matches §4.
