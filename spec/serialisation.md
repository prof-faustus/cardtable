# Spec: Canonical Serialisation

> **Status:** authoritative. Every protocol object on the wire, in
> `OP_RETURN` metadata, and inside script preimages uses the encoding
> rules below. JSON is permitted for debugging only; never as the
> canonical form (Formal Architecture §3.4).

## 1. Goals

- **Determinism.** Two honest implementations produce byte-identical
  output for the same logical input.
- **Forward compatibility.** Schema evolution is additive; old clients
  reject higher version bytes they cannot interpret rather than
  guessing.
- **Domain separation.** Hashes used as commitments include a leading
  type tag so a hash of one object class cannot collide with another.

## 2. Encoding rules

### 2.1 Primitive types

| Type | Encoding |
|---|---|
| `bool` | 1 byte: `0x00` (false) or `0x01` (true). Any other value rejects. |
| `u8` | 1 byte unsigned. |
| `u16` | 2 bytes little-endian unsigned. |
| `u32` | 4 bytes little-endian unsigned. |
| `u64` | 8 bytes little-endian unsigned. |
| `i32` | 4 bytes little-endian two's-complement. |
| `i64` | 8 bytes little-endian two's-complement. |
| `bytes32` | 32 raw bytes (e.g. hashes, pubkey hashes). |
| `pubkey33` | 33 bytes compressed secp256k1. |
| `sig` | DER-encoded ECDSA signature + 1-byte SIGHASH; total ≤ 73 bytes. |
| `varint` | Bitcoin-style varint (1, 3, 5, or 9 bytes). |
| `bytes` | `varint(len)` followed by `len` raw bytes. |
| `utf8_string` | `varint(byte_len)` followed by UTF-8 bytes; no NULL terminator. |

### 2.2 Composite types

Composites are tagged-and-versioned: every composite begins with

```
type_tag : u16    // unique per object class (see §4)
version  : u8     // composite-local version, starts at 1
```

followed by the fields in **declaration order** (from the
`protocol-types` definitions). Optional fields are encoded as `bool`
(present?) followed by the field's value when present.

### 2.3 Collections

- **Arrays (homogeneous, ordered):** `varint(count)` followed by each
  element in order.
- **Sets:** sorted by the type's canonical comparator (see §3) and
  encoded as arrays.
- **Maps:** sorted by key comparator and encoded as `[key, value]`
  pairs.

### 2.4 Reserved fields

A composite may define **reserved trailing bytes**. Older clients
**must** read and ignore unknown trailing bytes when version-compatible;
they **must not** silently truncate. A composite with reserved trailing
bytes longer than 4 KiB rejects.

## 3. Canonical comparators

| Type | Comparator |
|---|---|
| `bytes32`, `pubkey33`, `bytes` | lexicographic byte-order |
| Integers | numeric ascending |
| `utf8_string` | UTF-8 NFC, then lexicographic byte-order |
| Composites | encode each side, then byte-compare |

## 4. Type tags

Each composite class has a unique 16-bit tag. Tags are stable across
versions; new tags are appended.

| Tag | Class |
|---|---|
| `0x0001` | `RuleSet` |
| `0x0002` | `Player` |
| `0x0003` | `WalletIdentity` |
| `0x0004` | `GameInstance` |
| `0x0005` | `EntropyCommitment` |
| `0x0006` | `EntropyReveal` |
| `0x0007` | `DeckCommitment` |
| `0x0008` | `Card` (extended model) |
| `0x0009` | `RoundState` |
| `0x000A` | `SignedAction` |
| `0x000B` | `TimeoutBranch` |
| `0x000C` | `RevealProof` |
| `0x000D` | `SettlementResult` |
| `0x000E` | `RecoveryRecord` |
| `0x000F` | `AuditTranscript` |
| `0x0010` | `TxTemplateRef` |
| `0x0011` | `BindingFields` (the `OP_RETURN` metadata payload) |
| `0x0012` | `TableState` (open or locked table-root data) |
| `0x0013` | `PotState` |
| `0x0014` | `WireFrame` (the binary wire-protocol frame) |

## 5. Hashing

All hashes used as commitments use **domain-separated SHA-256**:

```
hash(object) = SHA-256( type_tag || canonical_encoding(object) )
```

The `stateHash` of a `RoundState` is computed as above with the
`stateHash` field itself zeroed (32 zero bytes) inside the encoding.

For `OP_HASH256`-based script preconditions, the **outer** hash is
SHA-256-of-SHA-256 (`OP_HASH256` semantics); the **inner** input is
the domain-separated encoding above.

## 6. Signatures

Signatures cover the **canonical encoding** of the signed-over scope,
not the full transaction. Specifically:

- `SignedAction.authorising_signature` covers the canonical encoding of
  the `SignedAction` with the signature field zeroed (zero-length
  `bytes`).
- Transaction signatures (BSV CHECKSIG/CHECKMULTISIG) use the standard
  BSV sighash algorithm, with `SIGHASH_ALL | SIGHASH_FORKID` (v1 fixed).

## 7. JSON debug form

Implementations **may** offer a JSON debug representation for
development builds. The JSON form **is not** canonical and **must not**
appear in:

- `OP_RETURN` metadata payloads.
- Wire protocol frames.
- Storage durables (Aerospike values, IndexedDB blobs).
- Signature scopes.

The JSON debug form is one-directional: an implementation may emit JSON
for logs but must not consume JSON as input for any protocol operation.

## 8. Conformance

A serialisation implementation conforms to this spec iff:

1. For every test vector at `spec/test-vectors/`, encoding produces the
   exact `expected_encoding` byte sequence.
2. Decoding accepts every `expected_encoding` and rejects every
   `invalid_encoding` with the listed error code.
3. Two implementations produce byte-identical output for every input
   in the test-vector set.

Both `packages/protocol-types` (TypeScript) and the Go port must
conform.
