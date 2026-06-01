# Changelog

All notable changes to cardtable are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-06-01

### Added

- **`apps/relay-go/pkg/txbuilder`** (Go) — port of `@cardtable/tx-builder`:
  `EncodeBsvTransaction`, `DecodeBsvTransaction`, BIP-143
  `ComputeSighash`, `ComputeTxId`, plus ECDSA signing via
  `github.com/decred/dcrd/dcrec/secp256k1/v4`. Cross-language
  conformance pins the encoded-tx layout and the BIP-143 sighash
  hex (`15b7dc05...`) across both implementations.
- **Relay `--spv-url`** flag: when set, `CurrentHeight` comes from
  polling the SPV service's `/headers/latest`. Falls back to
  `--start-height` when the URL is unreachable.
- **`internal/spv.HTTPHeightSource`**: thread-safe polling cache
  with `SetInitial`, `Current`, `Probe`, `Start`.
- **Production `RPCClient` test coverage**: mock HTTP server
  verifies `getblockcount`, `getblockhash`, `getblockheader`,
  `getmerkleproof` paths plus rpc-error propagation.
- **`tools/load-test`** — `cardtable-load-test` Node CLI: opens
  N concurrent WebSocket connections, drives one Join per
  session, reports connect / ack latency percentiles + throughput
  + error breakdown.
- **CI `chain-integration` job** (`continue-on-error: true`):
  brings up the full `docker compose --profile chain` stack
  (`bsv-node` + `spv` + `relay`) and smoke-tests the BSV
  JSON-RPC path. Allowed to fail to insulate PRs from
  third-party image-registry hiccups.

### Changed

- `CardLifecycleState` (TS + Go) widened to permit variant-specific
  states beyond the canonical five.
- `cloneState` / `cloneSeats` (Go) use empty-slice literals so
  JSON marshalling emits `[]` not `null` — the browser client
  used to crash reading `.length` on the returned state.

### CI

- `go mod tidy` runs before every `go vet` / `go build` /
  `go test` invocation so the runner populates `go.sum` from
  `go.mod`'s `require` directives without needing a committed
  `go.sum`.

## [0.1.0] — 2026-06-01

First tagged release. The codebase delivers a self-verifying,
cross-language reference implementation of the cardtable mental-poker
protocol end-to-end.

### Added

- **Specification** (`spec/`): state machine, transaction classes,
  script templates, timeout rules, recovery rules, canonical
  serialisation, ordering rules, card protocol, wire protocol,
  peer discovery, 10 test vectors including the cross-language
  mental-poker conformance vector.
- **`@cardtable/protocol-types`** (TS): branded primitives, RuleSet,
  RoundState, SignedAction discriminated union, canonical
  state-hash encoder, `computeStateHash` covering all fields
  including `concealed_deck`.
- **`@cardtable/state-engine`** (TS): pure `applyAction`,
  `verifyAndApply` async crypto gate, replay + crypto-gated replay,
  fallback graph enumeration + BSV-script materialisation, tx
  orchestrator producing unsigned BSV transactions for cooperative
  / timeout / recovery branches.
- **`@cardtable/crypto-cards`** (TS): verifiable distributed
  shuffle (SHA-256 counter-mode PRG per ADR-001), domain-separated
  commitments, per-card ECIES envelope (secp256k1 + HKDF-SHA-256
  + AES-256-GCM).
- **`@cardtable/script-templates`** (TS): 10 BSV script builders.
- **`@cardtable/tx-builder`** (TS): BSV transaction encode/decode,
  BIP-143 sighash + SIGHASH_FORKID, ECDSA DER signer, txid.
- **`@cardtable/wire-ts`** (TS): binary frame codec byte-symmetric
  with the Go relay.
- **`apps/client-web`** (TS): React + Vite + Zustand client with
  online (live WebSocket) and offline (in-process engine) modes.
- **`apps/relay-go/cmd/relay`** (Go): TCP + WebSocket relay binary.
- **`apps/relay-go/cmd/indexer`** (Go): server-side transcript
  audit CLI.
- **`apps/relay-go/cmd/spv`** (Go): BSV-node-backed SPV header +
  merkle-proof service. Stubbable RPC interface; the production
  client speaks Bitcoin Core-compatible JSON-RPC.
- **`apps/relay-go/pkg/types`**, **`pkg/engine`**, **`pkg/wire`**,
  **`pkg/cryptocards`** (Go): byte-symmetric reimplementations of
  the corresponding TS packages.
- **`apps/relay-go/internal`**: session manager with mental-poker
  verification gate, broadcast hub, TCP relay, stdlib WebSocket
  adapter.
- **`tools/transcript-verifier`** (Node CLI): crypto-gated audit.
- **`tools/transcript-recorder`** (Node CLI): drives a full round
  and writes a JSONL transcript.
- **`tests/integration`**: Node-driven end-to-end suite against
  the live relay binary (smoke + full mental-poker round).
- **`tests/browser-smoke`**: Playwright + headless Chromium suite
  (offline + online flows).
- **CI** (`.github/workflows/ci.yml`): 24 jobs per push across
  Ubuntu/macOS/Windows × Node 20/22 × Go 1.22/1.23 covering unit
  tests, multi-OS live binary, browser, Docker image (amd64 +
  arm64 cross-build), and GHCR publish on main.
- **Docker** (`apps/relay-go/Dockerfile`): multi-stage distroless
  image carrying `relay`, `indexer`, and `spv` binaries.
- **`docker-compose.yml`**: default `relay` profile, opt-in
  `chain` profile spinning up a regtest BSV node + the SPV
  service.
- **ADRs** (`docs/adr/`): 000 (source of truth), 001 (SHA-256
  counter-mode PRG for the shuffle), 002 (indexer / SPV
  colocation under `apps/relay-go/`).

### Cryptographic conformance

- Mental-poker mvp: `combined_entropy`, `first shuffled ordinal`,
  `commitment seat 0`, `deck commitment hash` locked across TS + Go.
- State hash for the reference S1 state:
  `ede024c39e71fb16e652fdf949978adf8426ac62cdadb1c2ccd1baf353a63d50`
  (TS + Go).
- BIP-143 sighash regression vector:
  `15b7dc05a4e49cfd12c725824793ca3607991659ef4940955b544e64de9faf4c`.

### Security & disclaimer

This is research / reference code. **Tokens carry no external
monetary value.** Not a regulated gambling product. The card
protocol's information-theoretic concealment property is delivered
via the ECIES primitive in `@cardtable/crypto-cards`; full
production hardening (Phase 6 adversarial scenarios against a real
BSV testnet, key rotation flows, formal proof obligations from
`spec/`) is out of scope for v0.1.

[Unreleased]: https://github.com/prof-faustus/cardtable/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/prof-faustus/cardtable/releases/tag/v0.1.1
[0.1.0]: https://github.com/prof-faustus/cardtable/releases/tag/v0.1.0
