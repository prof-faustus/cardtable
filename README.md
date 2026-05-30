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

## How to contribute

Until Phase 1 lands, there is no buildable code in this repository. Read
`PROJECT_SPEC.md` and the Formal Architecture document end-to-end before
proposing any change.
