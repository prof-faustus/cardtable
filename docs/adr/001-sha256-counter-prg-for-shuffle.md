# ADR-001: SHA-256 counter mode as the shuffle PRG

## Status

Accepted (2026-05-30). Amends `spec/card-protocol.md` §3.

## Context

`spec/card-protocol.md` §3 originally specified the Fisher-Yates byte
stream as a "Keccak-256-based byte stream seeded by `combined`". The
rest of the cryptographic surface — every commitment, the
`stateHash` of `RoundState`, the deck-commitment aggregation hash —
is SHA-256. Adopting Keccak-256 for one ancillary PRG would force
every conforming implementation to carry a second hash primitive,
which:

- the TypeScript reference (`@cardtable/crypto-cards`) cannot satisfy
  with the standard `crypto.subtle` API surface (Keccak-256 is not in
  the Web Crypto algorithm set);
- the Go reference can satisfy via `golang.org/x/crypto/sha3` (the
  legacy Keccak variant — _not_ the NIST-finalised SHA3-256, which
  is a different algorithm despite the shared sponge), forcing a
  third-party dependency we have so far avoided.

## Decision

The shuffle PRG is **SHA-256 counter mode**:

```
block_i  = SHA-256( combined (32 bytes) || u32_le(counter) )
counter  = 0, 1, 2, ...
byte_stream = block_0 || block_1 || block_2 || ...
```

The Fisher-Yates draws integers in `[0, max]` by reading four bytes
from the stream (little-endian u32) and applying rejection sampling
against the largest multiple of `(max + 1)` ≤ `2^32`.

## Consequences

- `spec/card-protocol.md` §3 is amended in this commit to read
  "SHA-256-counter-mode byte stream seeded by `combined`".
- Both reference implementations (`@cardtable/crypto-cards`,
  `apps/relay-go/pkg/cryptocards`) can be built with no
  cryptographic dependency beyond `crypto.subtle` (browser) and
  `crypto/sha256` (Go stdlib).
- The test vector at `spec/test-vectors/mental-poker.json` is the
  cross-language conformance surface — both implementations are
  pinned by `TestCrossLanguageConformance` / the equivalent vitest
  block to the same byte outputs.

## Alternatives considered

- **Adopt Keccak-256 as specified.** Rejected: forces a third
  cryptographic primitive across two languages for a single PRG
  call site.
- **SHA3-256 counter mode.** Rejected: SHA3-256 is a finalised NIST
  algorithm distinct from Keccak-256; calling it "Keccak-256"
  would be wrong, and SHA3-256 is also outside the default Web
  Crypto algorithm set.
- **HKDF-SHA-256 expand-step as the stream.** Equivalent under
  the same threat model and produces the same uniformity, but adds
  one composition layer of implementation surface vs. plain
  counter mode for no security gain.

## Security commentary

SHA-256 is a pseudorandom function under standard assumptions; under
the random-oracle model, SHA-256 counter mode is an
indistinguishable-from-uniform byte stream. Fisher-Yates with
rejection sampling produces an unbiased permutation provided the
underlying stream is uniform.

The shuffle's **integrity** (no participant can manipulate the deck
after the entropy reveal) depends on:

1. every player committing entropy before any reveal (already
   enforced at the state-machine layer);
2. the combined-entropy hash binding every player's contribution
   (every entropy is mixed in — flipping any input bit changes the
   output with overwhelming probability under SHA-256).

Both properties hold for the SHA-256 PRG construction.

For information-theoretic **concealment** of unrevealed cards, the
MVP commitment-based deck offers none — combined entropy is public,
and every honest engine can derive every per-position commitment.
Concealment is the responsibility of the extended one-UTXO-per-card
model documented in `spec/card-protocol.md` §6 (Phase 4+ extended).
