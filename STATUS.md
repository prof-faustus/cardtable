# Phase status

This file tracks which build phase each module of `cardtable` is currently in.
Update it in the same commit as the phase transition; never let this file lag
behind the code.

## Build phases (per CLAUDE.md §Build Order)

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo skeleton, CLAUDE.md, Formal Architecture document, .gitignore, LICENSE, empty directories with `.gitkeep` | **complete** |
| 1 | Protocol specification (`spec/`) and `packages/protocol-types` | not started |
| 2 | `packages/state-engine` + `packages/script-templates` (TypeScript) and the Go port at `apps/relay-go/pkg/engine` | not started |
| 3 | Open-information prototype: minimal browser client + Go relay; table flow without concealed cards | not started |
| 4 | Concealed single-card protocol: `packages/crypto-cards`, encrypted card UTXOs, fold without reveal | not started |
| 5 | Multi-card In-Between: pot, two visible cards, bet, third card, settlement, penalty logic, pre-signed fallback graph, transcript replay | not started |
| 6 | Adversarial hardening: all 14 named scenarios + deterministic replay + observability | not started |

## Module status

| Path | Phase | Status |
|---|---|---|
| `spec/` | 1 | empty |
| `spec/test-vectors/` | 1 | empty |
| `packages/protocol-types/` | 1 | empty |
| `packages/state-engine/` | 2 | empty |
| `packages/script-templates/` | 2 | empty |
| `packages/crypto-cards/` | 4 | empty |
| `apps/client-web/` | 3+ | empty |
| `apps/relay-go/` | 3+ | empty |
| `apps/indexer-go/` | 3+ | empty |
| `apps/spv-service-go/` | 3+ | empty |
| `tests/integration/` | 3+ | empty |
| `tests/simulation/` | 5+ | empty |
| `tests/adversarial/` | 6 | empty |
| `tests/replay/` | 5+ | empty |
| `tools/tx-simulator/` | 2+ | empty |
| `tools/deck-simulator/` | 4+ | empty |
| `tools/transcript-verifier/` | 5+ | empty |
| `docs/adr/` | all | started (ADR-000) |
| `docs/runbooks/` | 3+ | empty |
