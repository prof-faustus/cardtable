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
- Phase 6 (adversarial hardening) is **substantively complete**: TS A01–A10
  suite, full-round end-to-end test, and a Go session-layer adversarial suite,
  plus the on-chain BSV-layer scenarios — **double-spend** (engine
  `PickConflictWinner` conformance against `spec/test-vectors/double-spend-attempt.json`
  + confirmed/quorum precedence variants), **reorg** (new `internal/chain`
  reindexer: deepest-common-ancestor rewind + forward-apply per
  ordering-rules.md §5, reporting orphaned actions), and **mempool eviction**
  (new `internal/chain` rebroadcast tracker per §4: rebroadcast up to
  `relay_rebroadcast_max`=3 then `RECOVERY_RECOMMENDED`). All three are
  test-covered against the FakeRPC/simulated chain; live-node fuzzing remains
  future work.
- Released **v0.1.0** (2026-06-01): GHCR multi-arch relay image + native
  binaries; CHANGELOG present. CI (GitHub Actions) declares ~22 jobs across
  Linux/macOS/Windows × Node and Go matrices. Several `tests/` and `tools/`
  subdirs are still empty placeholders (tests colocated with packages instead).
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
