# cardtable — Dealerless Distributed Card-Game Protocol on BSV

[![CI](https://github.com/prof-faustus/cardtable/actions/workflows/ci.yml/badge.svg)](https://github.com/prof-faustus/cardtable/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)


> **Research code, in early scaffolding.** This repository implements the
> protocol specified in [`PROJECT_SPEC.md`](PROJECT_SPEC.md) and the spec
> documents under [`spec/`](spec/). Per the project's token model, tokens
> carry **no external monetary value** and the system is not a regulated
> gambling product. See [LICENSE](LICENSE).

## What this is

`cardtable` is a transaction-native, peer-to-peer, non-custodial protocol for
multiplayer card games on Bitcoin SV (post-Genesis). Every game event is a
signed BSV transaction; every game state is a committed UTXO with one
cooperative successor branch and one timeout-default successor branch; every
failure mode resolves to a deterministic on-chain consequence rather than an
operational judgement call.

First production target: **In-Between** (Acey-Deucey).

## Source of truth

| File | Role |
|---|---|
| [`PROJECT_SPEC.md`](PROJECT_SPEC.md) | Working build spec; coding standards; project structure; build order; do-not lists |
| [`spec/`](spec/) | Per-aspect protocol specification (state machine, transaction types, script templates, timeout rules, recovery rules, serialisation, ordering, card protocol, wire protocol, peer discovery) |
| [`spec/test-vectors/`](spec/test-vectors/) | Canonical input/output vectors that bind every implementation to identical behaviour |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records covering every design choice made under ambiguity |

## Stack (per PROJECT_SPEC.md §Technology Stack)

- **Client:** TypeScript (strict), React 18, Vite, Zustand, Dexie, Web Crypto, BSV TypeScript SDK
- **Backend:** Go 1.22+, WebSocket relay, Aerospike, Kafka, BSV Go SDK
- **Out of scope:** off-chain payment networks, second-layer rollups, alternative script extensions, Postgres/Redis for game state, ORM, GraphQL, server-managed game state. Every state transition is on-chain.

## Build phases (per PROJECT_SPEC.md §Build Order)

1. **Spec + protocol-types** — write `spec/`, the `protocol-types` package
2. **State engine + script templates** — deterministic rules + BSV script construction
3. **Open-information prototype** — table flow without concealed cards
4. **Concealed single-card** — entropy commit/reveal, encrypted card UTXOs
5. **Multi-card In-Between** — full game, pre-signed fallback graph, transcript replay
6. **Adversarial hardening** — all 14 named scenarios + deterministic replay

This repository is at **Phase 0** (skeleton only) at the time of this
commit. Subsequent commits will fill each phase in turn.

## Repository layout (per PROJECT_SPEC.md §Project Structure)

```
cardtable/
├── PROJECT_SPEC.md, README.md, LICENSE
├── spec/                # Protocol specification (source of truth for protocol behaviour)
├── packages/            # Shared TypeScript packages
│   ├── protocol-types/
│   ├── state-engine/
│   ├── script-templates/
│   └── crypto-cards/
├── apps/                # Runnable services
│   ├── client-web/      # React + Vite browser client
│   ├── relay-go/        # Go WebSocket relay
│   ├── indexer-go/      # Go indexer service
│   └── spv-service-go/  # Go SPV proof / header service
├── tests/               # Cross-package and adversarial tests
├── tools/               # Simulators, transcript verifier
└── docs/                # Architecture notes, ADRs, runbooks
```

Empty subdirectories are kept tracked with a `.gitkeep` file until the
corresponding phase fills them.

## Critical rules (excerpted from PROJECT_SPEC.md, repeated here for visibility)

- **Build to BSV consensus and the post-Genesis opcode set.** Use the BSV TypeScript / Go SDKs only.
- **Script is Turing-complete on BSV post-Genesis.** Timelocks live at the transaction level (`nLockTime`, input `nSequence`); no in-script timelock opcode is used by any cardtable template.
- **Tokens carry no external value.** This is not a regulated gambling product.
- **Zero fabrication.** Every number, claim, and technical statement traces
  to a source or is marked as an assumption with a tracked obligation.
- **No silent assumptions.** Hidden assumptions are defects; declare them on
  the face of the document.

## Quickstart

```bash
# 1. Install
pnpm install

# 2. Run every TS + Go suite locally (offline)
pnpm ci                                       # workspace build + test
(cd apps/relay-go && go test -v ./...)        # Go suite

# 3. Run the relay locally
(cd apps/relay-go && go build -o ../../bin/relay ./cmd/relay)
./bin/relay --addr :8080 --ws-addr :8081 \
  --game 00000000000000000000000000000000000000000000000000000000000000aa \
  --start-height 100

# 4. Drive a full mental-poker round against the running relay
CARDTABLE_RUN_LIVE=1 \
CARDTABLE_RUN_FULL_ROUND=1 \
CARDTABLE_WS_URL=ws://localhost:8081/ws \
CARDTABLE_GAME_ID=00000000000000000000000000000000000000000000000000000000000000aa \
  pnpm --filter @cardtable/integration-tests test

# 5. Or use Docker
docker compose up --build relay               # local build
docker run -p 8080:8080 -p 8081:8081 \
  ghcr.io/prof-faustus/cardtable-relay:latest # published multi-arch image
```

Browser client:

```bash
(cd apps/client-web && pnpm vite build && pnpm vite preview --port 4173)
# then open http://localhost:4173 and click "Connect to relay"
```

Record a transcript and verify it offline:

```bash
node ./tools/transcript-recorder/dist/index.js \
  --ws ws://localhost:8081/ws \
  --game-id 00000000000000000000000000000000000000000000000000000000000000aa \
  --out ./session.jsonl

node ./tools/transcript-verifier/dist/index.js \
  --transcript ./session.jsonl \
  --game-id 00000000000000000000000000000000000000000000000000000000000000aa

# OR the Go-side audit harness:
(cd apps/relay-go && go build -o ../../bin/indexer ./cmd/indexer)
./bin/indexer --transcript ./session.jsonl \
  --game-id 00000000000000000000000000000000000000000000000000000000000000aa
```

## Building on Windows

The Quickstart works as-is on Linux/macOS and in CI. On Windows hosts a few
environment quirks bite; apply these and every suite passes:

- **`pnpm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`** — caused by
  corporate TLS inspection re-signing the npm registry. Trust the Windows root
  store via Node's system-CA flag (Node ≥ 22):

  ```powershell
  $env:NODE_OPTIONS = "--use-system-ca"
  pnpm install
  ```

  Keep `NODE_OPTIONS=--use-system-ca` set for `pnpm install`/`build`/`test`.

- **`go test ./...` reports `... contains a virus or potentially unwanted
  software` and FAILs** — a false positive from the host antivirus (e.g.
  Norton/Defender) quarantining freshly-linked Go `*.test.exe` binaries (the
  `pkg/wire` test binary is the usual trigger). The code is fine. Build the
  test binaries with `-trimpath`, which changes the linked output enough to
  clear the heuristic, and make it the default:

  ```powershell
  go env -w GOFLAGS=-trimpath
  go test ./...                 # now green in one command
  ```

  A *cold* full relink (`go clean -testcache` then `go test ./...`) can still
  intermittently flake one timing-sensitive test
  (`internal/spv/TestHTTPHeightSource_TracksLatest`, a 2-second HTTP-poll
  deadline) when the AV scans every new binary at once. Warm re-runs are
  stable. To eliminate it permanently, add a folder exclusion in your AV for
  Go's temp dir (set a stable one with `go env -w GOTMPDIR=C:\Users\<you>\go-tmp`
  and exclude that folder).

- **Port `8081` already in use** — on machines running WSL, `wslrelay.exe`
  binds `127.0.0.1:8081`. Run the relay on an alternate port and point the
  integration tests at it:

  ```powershell
  .\bin\relay.exe --addr :8092 --ws-addr :8091 `
    --game 00000000000000000000000000000000000000000000000000000000000000aa --start-height 100
  $env:CARDTABLE_WS_URL = "ws://127.0.0.1:8091/ws"
  ```

  The `live-full-round` integration test and the online browser-smoke test each
  require a **fresh** relay (the relay holds session state in memory, so a
  reused seat collides). Restart the relay between those runs.

## How to contribute

Read `PROJECT_SPEC.md` and the per-aspect spec docs under `spec/`
end-to-end. Then check `STATUS.md` for the current phase + the
substantive gaps remaining. Tests live next to their code:
`packages/*/__tests__/`, `apps/relay-go/**/_test.go`, plus the
cross-system suites under `tests/integration/` and
`tests/browser-smoke/`.
