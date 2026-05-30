# Spec: Script Templates

> **Status:** authoritative. Every transaction class in `spec/tx-types.md`
> consumes outputs locked under exactly one of the templates below.
> Post-Genesis BSV opcode set is assumed (Formal Architecture A1).

## 1. Notation

- Capitalised words are BSV Script opcodes (e.g. `OP_CHECKSIG`,
  `OP_CHECKLOCKTIMEVERIFY`).
- `<x>` is a data push of `x`.
- Multi-line templates separated into `IF/ELSE/ENDIF` branches.
- Witness layout is given as `script_sig: ...` after each template.

## 2. Templates

### 2.1 `table-root` (open and locked variants share this skeleton)

Cooperative spend by every seated player; or refund after CLTV.

```
OP_IF
    // Cooperative: every seated player signs.
    <N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
OP_ELSE
    // Refund: absolute timeout, operator may reclaim fee pool + null pot.
    <recovery_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
    <operator_pk> OP_CHECKSIG
OP_ENDIF
```

- **Cooperative `script_sig`:** `OP_0 <sig_1> ... <sig_N> OP_1`.
- **Refund `script_sig`:** `<operator_sig> OP_0`.
- **N:** seat count (open variant uses `max_seats`; locked variant uses
  actual seated count).

### 2.2 `stake-lock` — per-player stake output

Three exits.

```
OP_IF
    // Cooperative: settle / move to pot. Player signs together with
    // table operator on a settlement transaction.
    <2> <player_pk> <operator_pk> <2> OP_CHECKMULTISIG
OP_ELSE
    OP_IF
        // Winner claim: a valid reveal proof + winner signature.
        OP_HASH256 <expected_settlement_hash> OP_EQUALVERIFY
        <player_pk> OP_CHECKSIG
    OP_ELSE
        // Refund after global recovery timeout.
        <recovery_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <player_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

- **Cooperative settle `script_sig`:** `OP_0 <player_sig> <operator_sig>
  OP_1`.
- **Winner claim `script_sig`:** `<player_sig> <settlement_preimage>
  OP_0 OP_1`.
- **Recovery refund `script_sig`:** `<player_sig> OP_0 OP_0`.

### 2.3 `pot-lock` — pot output

```
OP_IF
    // Cooperative settle.
    <N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
OP_ELSE
    OP_IF
        // Winner claim.
        OP_SHA256 <winner_proof_hash> OP_EQUALVERIFY
        <winner_pk> OP_CHECKSIG
    OP_ELSE
        // Recovery refund.
        <recovery_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <refund_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

### 2.4 `entropy-commit` — committed entropy

```
OP_IF
    // Reveal: spender provides entropy plaintext; script checks hash binding.
    OP_SHA256 <commitment_hash> OP_EQUALVERIFY
    <player_pk> OP_CHECKSIG
OP_ELSE
    // Timeout: relative locktime since commitment; recovery path.
    <decision_timeout_blocks> OP_CHECKSEQUENCEVERIFY OP_DROP
    OP_IF
        // Cooperative fallback: other players may continue without this
        // player's entropy by signing collectively.
        <M> <other_pk_1> ... <other_pk_M> <M> OP_CHECKMULTISIG
    OP_ELSE
        // Global recovery refund.
        <recovery_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <player_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

- **M = N − 1** (every counterparty of this committer).
- **Reveal `script_sig`:** `<player_sig> <entropy_plaintext> OP_1`.
- **Cooperative timeout `script_sig`:** `OP_0 <other_sig_1> ...
  <other_sig_M> OP_1 OP_0`.
- **Recovery refund `script_sig`:** `<player_sig> OP_0 OP_0`.

### 2.5 `card-custody` — encrypted card UTXO (extended model, Phase 4+)

Concealed-card custody for one card. Used in the extended one-UTXO-per-card
mode of `spec/card-protocol.md`. Not used by In-Between v1 directly
(In-Between reveals all cards publicly), but included here for forward
compatibility.

```
OP_IF
    // Reveal: spender provides face preimage; script verifies commitment.
    OP_HASH256 <face_commitment> OP_EQUALVERIFY
    <holder_pk> OP_CHECKSIG
OP_ELSE
    OP_IF
        // Fold surrender: holder signs without revealing face.
        <holder_pk> OP_CHECKSIG
    OP_ELSE
        // Recovery: global timeout returns custody to original funder.
        <recovery_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <original_funder_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

### 2.6 `fold-surrender` — output produced by a fold

Reserved for Phase 4+. Locks the concealed card object so that it is
neither spent into the pot (no reveal) nor recoverable by anyone other
than the original funder after the global recovery timeout. Witness
identical to the recovery branch of `card-custody`.

### 2.7 `round-state` — committed round state

The action-right output of every actionable round state.

```
OP_IF
    // Action-right: acting player signs the successor template hash.
    OP_HASH256 <successor_template_hash> OP_EQUALVERIFY
    <acting_player_pk> OP_CHECKSIG
OP_ELSE
    OP_IF
        // Decision timeout: relative locktime since this state was established.
        // Any party may broadcast the default Timeout tx.
        <decision_timeout_blocks> OP_CHECKSEQUENCEVERIFY OP_DROP
        OP_HASH256 <timeout_template_hash> OP_EQUALVERIFY
        <any_player_pk_set> OP_CHECKMULTISIG
    OP_ELSE
        // Global recovery: absolute CLTV.
        <recovery_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
        <N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
    OP_ENDIF
OP_ENDIF
```

The third (recovery) branch's multisig is structurally n-of-n but the
**cooperative recovery transaction** is pre-signed at session start by
every seated player (see `spec/recovery-rules.md`).

### 2.8 `settle-claim` — winner takes from pot

```
OP_HASH256 <settlement_commitment> OP_EQUALVERIFY
<winner_pk> OP_CHECKSIG
```

Simple form; no fallback branch — the `settlement_commitment` is bound
by the round-state output that this transaction also consumes, so the
winner-claim path is gated by the cooperative or timeout settlement of
that round-state.

### 2.9 `recovery-claim` — Recovery transaction unlocks

Multi-input transaction. Each consumed output is unlocked by its own
recovery branch as defined per template above. No new template is
required for `Recovery`; it is a multi-input spend across many existing
locked outputs, each satisfying its recovery branch.

## 3. Encoding rules

- Small integers `0..16` push as `OP_0` / `OP_1`..`OP_16`. Integers
  outside that range push as minimal-encoded script numbers (BSV
  post-Genesis CHECKMULTISIG accepts script-number `m`/`n` operands
  for `m, n > 16`).
- All public keys are 33-byte compressed secp256k1.
- All hashes inside scripts are 32-byte SHA-256 (`OP_HASH256`) unless
  otherwise stated; 20-byte HASH160 may be used for size-sensitive
  preimage commitments and is called out per-template.
- Signatures are DER-encoded with the SIGHASH byte appended; in v1
  every signature uses `SIGHASH_ALL | SIGHASH_FORKID`.

## 4. Conformance

A script-templates implementation conforms to this spec iff, for every
template above, it can:

1. Build the locking script byte-for-byte identical to the canonical
   serialisation of this document's template (resolved with the
   appropriate pubkeys, heights, and hashes).
2. Build a valid witness for every branch listed.
3. Reject malformed witnesses for each branch (e.g. wrong number of
   sigs, missing preimage, locktime not yet matured).

Both the TypeScript builder (`packages/script-templates`) and the Go
builder (under `apps/relay-go/pkg/...` if/when a Go builder exists)
must conform.
