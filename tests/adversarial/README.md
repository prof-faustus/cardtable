# Adversarial scenario suite

The 14 mandatory adversarial scenarios (`PROJECT_SPEC.md` §783) are
implemented as a Go test package at:

    apps/relay-go/tests/adversarial/

It lives **inside the `relay-go` Go module** by necessity: the scenarios
drive the relay's `internal/session` and `internal/chain` packages, and
Go's `internal/` visibility rule only permits imports from within the
same module (rooted at `apps/relay-go`). A package at this repo-root path
could import the exported `pkg/*` APIs but not the `internal/*` session
and chain logic the scenarios exercise.

Files there, mapped to the spec scenarios:

| File | Scenarios |
|---|---|
| `disconnect_scenarios_test.go` | 1, 2, 5 |
| `timeout_race_test.go` | 4, 7 |
| `stale_action_test.go` | 6 |
| `withheld_reveal_test.go` | 3 |
| `duplicate_message_test.go` | 9, 10 |
| `conflicting_spend_test.go` | 11 (session layer) |
| `chain_scenarios_test.go` | 11 (txid ordering), reorg |
| `mempool_eviction_test.go` | 12 |
| `invalid_branch_test.go` | 13 + illegal-action guards |
| `recovery_branch_test.go` | 8, 14 |
| `vectors_test.go` | executes the Phase-6 `spec/test-vectors` fixtures |

The TypeScript engine carries a parallel suite at
`packages/state-engine/__tests__/adversarial-scenarios.test.ts`.

Run: `cd apps/relay-go && go test ./tests/adversarial/`
