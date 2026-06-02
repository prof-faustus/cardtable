# Status — Poker (cardtable)

_Last updated: 2026-06-02_

**Overall:** Active/in-progress

## What this is
`cardtable` — a transaction-native, peer-to-peer, non-custodial protocol for
multiplayer card games on Bitcoin SV (post-Genesis), where every game event is a
signed BSV transaction and every state is a committed UTXO with cooperative and
timeout-default successor branches. First production target: In-Between
(Acey-Deucey). TypeScript client + Go relay monorepo (pnpm workspace).

## Current state
- Build phases 0–3 **complete** (spec + protocol-types; state-engine +
  script-templates with a Go port; open-information prototype: React/Vite/Zustand
  browser client + Go TCP/WebSocket relay).
- Phase 4 (concealed single card) and Phase 5 (multi-card In-Between) are
  **substantively complete**: verifiable distributed shuffle with cross-language
  conformance, deck commitment + CardReveal proof verification, per-card ECIES
  concealment, fallback-graph enumeration, crypto-gated replay, and a
  `@cardtable/tx-builder` BSV encoder (BIP-143 sighash + DER signer) producing
  unsigned per-branch transactions.
- Phase 6 (adversarial hardening) is **complete**. All 14 mandatory scenarios
  (PROJECT_SPEC §783) are covered by a named Go suite,
  `apps/relay-go/tests/adversarial` (24 tests across disconnect/timeout/stale/
  withheld-reveal/duplicate/conflicting-spend/mempool/invalid-branch/recovery +
  chain files), alongside the TS A01–A10 suite and the full-round e2e. On-chain
  scenarios are deterministic: **double-spend** (engine `PickConflictWinner`
  conformance against `double-spend-attempt.json` + the new
  `timeout-canonicity.json`), **reorg** (`internal/chain` reindexer: DCA rewind
  + forward-apply per ordering-rules §5), **mempool eviction** (`internal/chain`
  rebroadcast tracker per §4). The previously-empty Phase-6 areas are now built
  out as green `@cardtable/*` packages: `tools/deck-simulator`,
  `tools/tx-simulator`, `tests/replay`, `tests/simulation`. New
  `spec/test-vectors` (timeout-canonicity, mempool-eviction, reorg-restart,
  fee-handling, duplicate-idempotency) are wired to real code (TS + Go).
- **Live on-chain verification done:** the `docker compose --profile chain`
  stack (regtest `bitcoinsv/bitcoin-sv:1.1.0` + the cardtable SPV service) was
  brought up in a VM and the SPV `/headers/latest` verified to track the live
  chain tip as blocks were mined (8→14→18); a relay boots wired to the live SPV.
  Two latent compose bugs were fixed in the process (missing `bitcoind` argv0;
  missing `-minminingtxfee`). Automated as the CI `chain-integration` job;
  see `docs/runbooks/live-chain-e2e.md`.
- Released **v0.1.0** (2026-06-01): GHCR multi-arch relay image + native
  binaries; CHANGELOG present. CI (GitHub Actions) declares ~22 jobs across
  Linux/macOS/Windows × Node and Go matrices, plus a `chain-integration` job.
  All `tests/` and `tools/` subdirs are now populated (the repo-root
  `tests/adversarial` documents the in-module Go suite location).
- TS/Go references pinned to identical bytes via
  `spec/test-vectors/mental-poker.json`. **Test suites re-run 2026-06-02 and
  green**: TS `pnpm build && pnpm test` = 198 tests across 8 packages passing;
  Go `go vet ./... && go test ./...` clean across all packages (incl. the new
  `internal/chain` and `pkg/engine` ordering/double-spend tests). Integration
  (live WS) and Playwright browser-smoke suites not run this pass.

## Version control
- Git: yes, branch `main`. Working tree clean as of the Phase 6 on-chain
  scenario commit (see `git log` for the current HEAD).

## How to verify / build
- `package.json` (pnpm workspace, `pnpm-workspace.yaml`): typecheck + build +
  test per `@cardtable/*` package across Node 20/22 (see README/STATUS for the
  CI matrix). Go: `go vet ./...` + `go test -v ./...` in `apps/relay-go/`.
- Local run: `docker compose up --build relay` (relay only) or `docker compose
  --profile chain up --build` (regtest bsv-node + spv + relay).
- Integration/browser suites: `@cardtable/integration-tests` (live WS) and
  Playwright browser-smoke. Not run this pass.
