# Spec: Script Templates

> **Status:** authoritative. Every transaction class in `spec/tx-types.md`
> consumes outputs locked under exactly one of the templates below.
> Post-Genesis BSV opcode set is the assumed runtime.
>
> **No in-script timelock opcode is used by any template.** Timing
> constraints on every time-gated branch are enforced at the **spending
> transaction level** by `nLockTime` (absolute) and input `nSequence`
> (relative). The script merely authorises the signers; the spending
> transaction itself encodes the time gate, and consensus enforces it.

## 1. Notation

- Capitalised words are BSV Script opcodes (`OP_CHECKSIG`, `OP_HASH256`,
  `OP_CHECKMULTISIG`, `OP_IF` / `OP_ELSE` / `OP_ENDIF`, `OP_EQUALVERIFY`,
  `OP_DROP`).
- `<x>` is a data push of `x`.
- Branches are listed with their **transaction-level locktime spec** —
  the shape the downstream tx builder applies to the spending tx's
  `nLockTime` / `nSequence` fields. Three locktime kinds:
  - `immediate` — no time gate; spendable as soon as the locking
    output is final.
  - `absolute_height(H)` — spending tx carries `nLockTime = H`;
    consensus rejects it before block height `H`.
  - `relative_blocks(N)` — spending tx's input carries non-final
    `nSequence` encoding `N` blocks relative-locktime; consensus
    rejects it before `N` blocks have elapsed since the locking
    output was confirmed.

## 2. Templates

### 2.1 `table-root`

```
<N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
```

**Branches:**

| Name | Locktime | Witness shape |
|---|---|---|
| `cooperative` | `immediate` | `OP_0 <sig_1> ... <sig_N>` |
| `recovery` | `absolute_height(recovery_height)` | same multisig witness; spending tx's `nLockTime = recovery_height` |

`N` is the seat count. Both branches satisfy the same multisig; the
distinguishing transaction is the spending tx (different output
structures, different `nLockTime`).

### 2.2 `stake-lock`

Three IF/ELSE sub-branches over signature / preimage checks.

```
OP_IF                                          // 1. cooperative
    <2> <player_pk> <operator_pk> <2> OP_CHECKMULTISIG
OP_ELSE
    OP_IF                                      // 2. winner claim
        OP_HASH256 <expected_settlement_hash> OP_EQUALVERIFY
        <player_pk> OP_CHECKSIG
    OP_ELSE                                    // 3. refund
        <player_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

**Branches:**

| Name | Locktime | Witness shape |
|---|---|---|
| `cooperative` | `immediate` | `OP_0 <player_sig> <operator_sig> OP_1` |
| `winner_claim` | `immediate` | `<player_sig> <settlement_preimage> OP_0 OP_1` |
| `refund` | `absolute_height(recovery_height)` | `<player_sig> OP_0 OP_0` |

### 2.3 `pot-lock`

```
OP_IF                                          // cooperative
    <N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
OP_ELSE
    OP_IF                                      // winner claim
        OP_SHA256 <winner_proof_hash> OP_EQUALVERIFY
        <winner_pk> OP_CHECKSIG
    OP_ELSE                                    // refund
        <refund_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

**Branches:**

| Name | Locktime |
|---|---|
| `cooperative` | `immediate` |
| `winner_claim` | `immediate` |
| `refund` | `absolute_height(recovery_height)` |

### 2.4 `entropy-commit`

One UTXO per player carrying that player's entropy commitment.

```
OP_IF                                          // reveal
    OP_SHA256 <commitment_hash> OP_EQUALVERIFY
    <player_pk> OP_CHECKSIG
OP_ELSE
    OP_IF                                      // cooperative fallback
        <M> <other_pk_1> ... <other_pk_M> <M> OP_CHECKMULTISIG
    OP_ELSE                                    // refund
        <player_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

With `M = n - 1` (every counterparty). When `M = 0` (degenerate
single-seat case), the cooperative-fallback inner body is replaced by
`OP_RETURN` so the branch is unsatisfiable.

**Branches:**

| Name | Locktime |
|---|---|
| `reveal` | `immediate` |
| `cooperative_fallback` | `relative_blocks(decision_timeout_blocks)` |
| `refund` | `absolute_height(recovery_height)` |

### 2.5 `card-custody` (Phase 4+ extended model only)

```
OP_IF                                          // reveal
    OP_HASH256 <face_commitment> OP_EQUALVERIFY
    <holder_pk> OP_CHECKSIG
OP_ELSE
    OP_IF                                      // fold surrender
        <holder_pk> OP_CHECKSIG
    OP_ELSE                                    // recovery refund
        <original_funder_pk> OP_CHECKSIG
    OP_ENDIF
OP_ENDIF
```

**Branches:**

| Name | Locktime |
|---|---|
| `reveal` | `immediate` |
| `fold_surrender` | `immediate` |
| `recovery_refund` | `absolute_height(recovery_height)` |

The fold-surrender branch carries no face preimage check, so a fold
does **not** reveal the card face.

### 2.6 `fold-surrender` (Phase 4+ extended model only)

The locking script of an output produced by a fold:

```
<original_funder_pk> OP_CHECKSIG
```

Bare signature check. The recovery refund tx that spends this output
carries `nLockTime = recovery_height`; consensus rejects it before that
height.

**Branches:**

| Name | Locktime |
|---|---|
| `recovery_refund` | `absolute_height(recovery_height)` |

### 2.7 `round-state`

```
OP_IF                                          // action
    OP_HASH256 <successor_template_hash> OP_EQUALVERIFY
    <acting_player_pk> OP_CHECKSIG
OP_ELSE
    OP_IF                                      // timeout
        OP_HASH256 <timeout_template_hash> OP_EQUALVERIFY
        <N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
    OP_ELSE                                    // recovery
        <N> <pk_1> ... <pk_N> <N> OP_CHECKMULTISIG
    OP_ENDIF
OP_ENDIF
```

**Branches:**

| Name | Locktime |
|---|---|
| `action` | `immediate` |
| `timeout` | `relative_blocks(decision_timeout_blocks)` |
| `recovery` | `absolute_height(recovery_height)` |

The timeout and recovery branches are signed by the same n-of-n set,
distinguished by their template-hash preimage and by the timing
constraints on the spending transaction.

### 2.8 `settle-claim`

```
OP_HASH256 <settlement_commitment> OP_EQUALVERIFY
<winner_pk> OP_CHECKSIG
```

Single branch, `immediate` locktime. Gating is provided by the round-
state output this transaction also consumes.

### 2.9 `reveal-proof`

```
OP_HASH256 <card_commitment> OP_EQUALVERIFY
<signer_pk> OP_CHECKSIG
```

Standalone reveal-verification script. Useful for unit-testing the
preimage-binding semantics separately from the surrounding template.

### 2.10 `recovery-branch`

```
<signer_pk> OP_CHECKSIG
```

A bare signature check; the spending recovery transaction carries
`nLockTime = recovery_height` and that is what enforces the timing.

## 3. Encoding rules

- Small integers `0..16` push as `OP_0` / `OP_1`..`OP_16`. Larger
  integers push as minimal-encoded script numbers; post-Genesis
  `OP_CHECKMULTISIG` accepts these for `m` / `n` operands > 16.
- All public keys are 33-byte compressed secp256k1.
- All hashes inside scripts are 32-byte SHA-256 via `OP_HASH256` unless
  otherwise stated.
- Signatures are DER-encoded with the SIGHASH byte appended; v1 uses
  `SIGHASH_ALL | SIGHASH_FORKID` for every signature.

## 4. Pre-signed fallback graph

At session start (immediately after `TableLock`), every seated player
signs every fallback transaction in the protocol's expected
trajectory. Each fallback tx carries its branch's locktime constraint
directly on its `nLockTime` / `nSequence` fields. The pre-signed txs
are distributed peer-to-peer and stored in the `AuditTranscript`; any
participant may broadcast them once the relevant gate matures.

## 5. Conformance

A script-templates implementation conforms to this spec iff:

1. For every template, it builds the canonical locking script bytes
   byte-for-byte identical to the spec.
2. For every template, the returned branch table names every legal
   exit, in the order listed above, with the correct `LockTimeSpec`.
3. No produced script contains the inert no-op opcodes `0xb1` /
   `0xb2`. (These opcodes are not used by any cardtable template;
   their absence is part of the conformance surface.)

The TypeScript builder at `packages/script-templates/` conforms to
this spec and asserts the absence of `0xb1` / `0xb2` in its test
suite.
