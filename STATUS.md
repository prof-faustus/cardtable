# Phase status

This file tracks which build phase each module of `cardtable` is currently in.
Update it in the same commit as the phase transition; never let this file lag
behind the code.

## Build phases (per PROJECT_SPEC.md §Build Order)

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo skeleton, PROJECT_SPEC.md, Formal Architecture document, .gitignore, LICENSE, empty directories with `.gitkeep` | **complete** |
| 1 | Protocol specification (`spec/`) and `packages/protocol-types` | **complete** |
| 2 | `packages/state-engine` + `packages/script-templates` (TypeScript) and the Go port at `apps/relay-go/pkg/engine` | **complete** |
| 3 | Open-information prototype: browser client + Go relay; table flow without concealed cards | **complete** (3a Go state engine, 3b TCP relay + session + hub, 3c.1 TS wire codec + React/Vite/Zustand scaffold, 3c.2 stdlib WebSocket adapter + browser RelayClient, 3c.3 Zustand wired to RelayClient with online/offline modes) |
| 4 | Concealed single-card protocol: `packages/crypto-cards`, encrypted card payloads, fold without reveal | **substantively complete** (4.1 verifiable distributed shuffle + cross-language conformance, 4.2 engine wiring for entropy commit/reveal verification, 4.3 deck commitment materialised at S5 + CardReveal proof verification, 4-extended ECIES per-card concealment primitive). Still ahead: one-UTXO-per-card lifecycle in protocol-types, Fold action handler, BSV-transaction integration of the encrypted payload. |
| 5 | Multi-card In-Between: pot, two visible cards, bet, third card, settlement, penalty logic, pre-signed fallback graph, transcript replay | **partial** (5.1 fallback-graph enumeration, 5.2 crypto-gated replayWithVerification, full-round end-to-end test exercises Pot/Visible/Bet/Third/Settle). Still ahead: BSV-transaction construction per fallback branch, full pre-signed graph at session start. |
| 6 | Adversarial hardening: all 14 named scenarios + deterministic replay + observability | **partial** (6.1 TS named adversarial suite A01-A10, 6.2 full-round end-to-end test, 6.3 Go session-layer adversarial suite + indexer audit command). Still ahead: the remaining named scenarios that depend on the BSV layer (double-spend at on-chain layer, reorg, mempool eviction). |

## Module status

| Path | Phase | Status |
|---|---|---|
| `spec/state-machine.md` | 1 | **complete** |
| `spec/tx-types.md` | 1 | **complete** |
| `spec/script-templates.md` | 1 | **complete** |
| `spec/timeout-rules.md` | 1 | **complete** |
| `spec/recovery-rules.md` | 1 | **complete** |
| `spec/serialisation.md` | 1 | **complete** |
| `spec/ordering-rules.md` | 1 | **complete** |
| `spec/card-protocol.md` | 1 | **complete (MVP)** — ADR-001 records the SHA-256 counter-mode PRG substitution |
| `spec/wire-protocol.md` | 1 | **complete** |
| `spec/peer-discovery.md` | 1 | **complete** |
| `spec/test-vectors/` | 1 | **complete** — 9 vectors including `mental-poker.json` for the cross-language conformance |
| `packages/protocol-types/` | 1 | **complete** — canonical encoding + branded types + hashing + commitment fields on PlayerState / RoundState |
| `packages/state-engine/` | 2 | **complete** — pure engine + `verifyAndApply` async gate + replay + `replayWithVerification` + fallback graph enumeration |
| `packages/script-templates/` | 2 | **complete** — 10 BSV script builders + structural tests |
| `packages/wire-ts/` | 3 | **complete** — binary frame codec byte-identical to `apps/relay-go/pkg/wire` |
| `packages/crypto-cards/` | 4 | **complete (MVP)** — verifiable distributed shuffle + per-card ECIES concealment primitive |
| `apps/client-web/` | 3 | **complete (open-info)** — React/Vite/Zustand + RelayClient with online/offline modes |
| `apps/relay-go/` | 3 | **complete** — Go state-engine port + TCP relay + WebSocket adapter + `cmd/indexer` audit harness |
| `apps/indexer-go/` | 3+ | **placeholder** — indexer command currently lives at `apps/relay-go/cmd/indexer` (ADR-002) |
| `apps/spv-service-go/` | 3+ | empty |
| `tests/integration/` | 3+ | empty (current cross-module tests are colocated with their packages) |
| `tests/simulation/` | 5+ | empty |
| `tests/adversarial/` | 6 | empty (adversarial scenarios currently colocated with `packages/state-engine/__tests__/` and `apps/relay-go/internal/session/`) |
| `tests/replay/` | 5+ | empty |
| `tools/tx-simulator/` | 2+ | empty |
| `tools/deck-simulator/` | 4+ | empty |
| `tools/transcript-verifier/` | 5+ | empty (the `cmd/indexer` covers the Go side; a TS analogue would go here) |
| `docs/adr/` | all | **3 ADRs accepted**: ADR-000 (source of truth), ADR-001 (SHA-256 counter PRG), ADR-002 (indexer colocation) |
| `docs/runbooks/` | 3+ | empty |

## Cross-language conformance

The TypeScript and Go references are pinned to identical byte outputs for
the mental-poker commitment-based MVP via `spec/test-vectors/mental-poker.json`
and the matching `TestCrossLanguageConformance` block (`apps/relay-go/pkg/cryptocards/conformance_test.go`)
and `__tests__/conformance.test.ts` (`packages/crypto-cards`).

## CI

GitHub Actions runs three job classes on every push to `main`:

- `typecheck + build + test` × {Ubuntu, macOS, Windows} × {Node 20, 22} — runs every `@cardtable/*` package's `build` and `test` scripts via pnpm.
- `go vet + test` × {Ubuntu, macOS, Windows} × {Go 1.22, 1.23} — runs `go vet ./...` and `go test ./...` against `apps/relay-go/`.
- `spec docs + test vectors are valid JSON` — `jq -e` on every `spec/test-vectors/*.json` and a presence check on every required `spec/*.md`.

13 jobs total per push; the build is green at `bc2e877`.
