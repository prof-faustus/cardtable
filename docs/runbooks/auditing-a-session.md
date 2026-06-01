# Auditing a session

Cardtable's mental-poker integrity property is verifiable from the
recorded transcript alone — no operator trust required. Two CLI tools
handle the record-and-replay loop.

## Recording a session

`cardtable-transcript-recorder` drives a full In-Between round against a
live relay and writes one JSON-encoded `SignedAction` per line to the
output file.

```bash
# Assumes a relay is already running on :8081 (see running-locally.md).
node ./tools/transcript-recorder/dist/index.js \
  --ws ws://localhost:8081/ws \
  --game-id 00000000000000000000000000000000000000000000000000000000000000aa \
  --out ./session.jsonl
# stderr: wrote N actions to ./session.jsonl
```

The recorder uses `@cardtable/crypto-cards` to produce real entropy
commitments and reveal proofs, so the resulting transcript is by
construction conformant — the relay accepted every action through its
verification gate.

## Verifying a recorded session

Two equivalent verifiers ship with the repo:

### Node-side: `cardtable-transcript-verifier`

```bash
node ./tools/transcript-verifier/dist/index.js \
  --transcript ./session.jsonl \
  --game-id 00000000000000000000000000000000000000000000000000000000000000aa
```

Runs every action through `verifyAndApply` — the same crypto-gated
production path the relay uses. On success, prints a JSON summary with
the final state class, pot value, deck commitment hash, and the
canonical state hash. On the first invalid action, exits non-zero with
the offending index and the `ProtocolError.code` the engine returned.

### Server-side: `cmd/indexer`

The Go binary takes the same JSONL input:

```bash
./bin/indexer \
  --transcript ./session.jsonl \
  --game-id 00000000000000000000000000000000000000000000000000000000000000aa
```

`cmd/indexer` runs through the pure Go engine (no crypto gate); the
TypeScript verifier above runs through the async crypto gate. Both
should agree on the final state class for any transcript a real relay
accepted.

## What a successful audit proves

- Every `EntropyCommit` was followed by an `EntropyReveal` whose
  plaintext hashes back to the commitment (no after-the-fact entropy
  substitution).
- Every `CardReveal` carries a reveal proof that recomputes the
  per-position commitment in the deck derived from the combined
  entropy (no card-value forgery).
- The final state hash matches what every honest engine derives from
  the transcript (verifiable replay).

## What a failed audit looks like

```text
REJECTED at index 4: EntropyReveal -> INVALID_REVEAL_PROOF: entropy does not match prior commitment
```

The audit halts at the first invalid action; the relay would have done
the same.

## Cross-language conformance

The same conformance constants both verifiers honour:

| Field | Constant |
|---|---|
| Mental-poker shuffle outputs | logged via `mental-poker.json` |
| Canonical state hash (empty S1) | `ede024c39e71fb16e652fdf949978adf8426ac62cdadb1c2ccd1baf353a63d50` |
| BIP-143 sighash (reference fixture) | `15b7dc05a4e49cfd12c725824793ca3607991659ef4940955b544e64de9faf4c` |

Both TS and Go references are pinned to these constants via cross-runner
test assertions; any drift fails CI on every push.
