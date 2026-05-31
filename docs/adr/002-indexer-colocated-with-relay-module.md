# ADR-002: Indexer command colocated with the relay Go module

## Status

Accepted (2026-05-31). Records a deviation from PROJECT_SPEC.md
§Project Structure pending a future split.

## Context

PROJECT_SPEC.md §Project Structure declares `apps/indexer-go/` as a
separate Go module. The indexer command's natural inputs are the
engine, cryptocards, and protocol-types packages — all of which live
inside `apps/relay-go/pkg/`. Splitting the indexer into its own
module today would require either:

- A `replace github.com/prof-faustus/cardtable/relay-go => ../relay-go`
  directive plus a populated `go.sum` pinned to the same versions
  in both modules; the dev workflow has no Go toolchain locally so
  generating `go.sum` is gated on CI, which is awkward for the
  bootstrap commit; or
- Hoisting `pkg/types`, `pkg/engine`, `pkg/cryptocards` into a
  third "shared" module under a new top-level `pkg/`. That's the
  right destination eventually but unnecessary at this scale.

The indexer command (`apps/relay-go/cmd/indexer`) is the first
consumer of the engine outside the relay binary itself; deferring
the module split until a second consumer materialises (the SPV
service, or a CLI replayer) keeps the build graph simple.

## Decision

The indexer command lives at `apps/relay-go/cmd/indexer` for now,
inside the same Go module as the relay. `apps/indexer-go/` is kept
as an empty placeholder until the module is split.

## Consequences

- One Go module (`github.com/prof-faustus/cardtable/relay-go`)
  builds both `cmd/relay` and `cmd/indexer`.
- CI runs `go vet ./...` + `go test ./...` once and exercises both
  binaries together.
- When a third consumer of the engine arrives (or when persistent
  indexer storage / Kafka emission lands), the shared packages will
  be hoisted into a `pkg/` module and the indexer relocated to
  `apps/indexer-go/`.

## Alternatives considered

- **Split now.** Rejected: bootstrapping the indexer module's
  `go.sum` against the relay's own version is harder than colocating
  the command. The split is reversible.
- **Single binary with subcommands.** Rejected: the relay listens
  on TCP+WS and runs indefinitely; the indexer runs to completion
  and prints. Bundling them blurs the lifetime.
