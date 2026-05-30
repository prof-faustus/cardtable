# ADR-000: Source of truth and document precedence

## Status

Accepted (2026-05-30). Records the starting state of the repository.

## Context

The project's normative content lives in two places inside the
repository:

1. `PROJECT_SPEC.md` at the root — the working build spec covering
   project identity, coding standards, project structure, technology
   stack, transaction classes, wire protocol, peer-discovery
   architecture, card object model, timeout matrix, data model, Kafka
   event model, testing strategy, security model, API contracts,
   build order, error-handling philosophy, logging conventions, UI
   hierarchy, configuration, git workflow, open proof obligations,
   and the "what NOT to build" list.

2. The per-aspect spec documents under `spec/` — `state-machine.md`,
   `tx-types.md`, `script-templates.md`, `timeout-rules.md`,
   `recovery-rules.md`, `serialisation.md`, `ordering-rules.md`,
   `card-protocol.md`, `wire-protocol.md`, `peer-discovery.md` —
   together with the canonical JSON test vectors at
   `spec/test-vectors/`.

Without a stated precedence rule, contributors will draw conflicting
conclusions from minor differences in phrasing between the two.

## Decision

Both surfaces are normative. Where they overlap and agree, the
agreement binds. Where they overlap and disagree, the following
precedence rules apply, in order:

1. **For rules of engagement and project hygiene** (coding standards,
   project structure, build order, what NOT to build, BSV consensus
   and post-Genesis opcode set, token-model statements, git workflow,
   error-handling philosophy, logging conventions, test categories,
   security-model high-level rules), `PROJECT_SPEC.md` is
   authoritative.

2. **For substantive protocol claims** (state machine, transaction
   classes, script semantics, timeout semantics, conflict-resolution
   rules, data-model fields, recovery rules), the per-aspect spec
   docs under `spec/` are authoritative. PROJECT_SPEC.md summaries
   that conflict are reported as bugs against PROJECT_SPEC.md.

3. **For the canonical machine-readable form** of any object, the
   `protocol-types` package and `spec/serialisation.md` are
   authoritative. Disagreements with prose in either document are
   reported as bugs against the prose.

4. **For test vectors and runtime behaviour**, `spec/test-vectors/` is
   authoritative. A test vector that disagrees with a prose claim is
   resolved by amending whichever the test author judges to be wrong,
   with the change recorded in a follow-up ADR.

Disagreements that cannot be resolved by the rules above must be
filed as ADRs (`docs/adr/NNN-...`) that name the disagreement, resolve
it, and amend the relevant document(s).

## Consequences

- Contributors have a single rule to apply when sources appear to
  differ.
- Every protocol claim has exactly one authoritative location in the
  repository.
- The phase status of the repository is tracked separately in
  `STATUS.md`.

## Alternatives considered

- **PROJECT_SPEC.md only.** Rejected: a single monolithic spec hides
  the per-aspect protocol claims behind the surrounding rules of
  engagement; reviewers need separable, citable documents per
  protocol concern.
- **`spec/` only.** Rejected: contributors need a single top-level
  brief that names the project's rules of engagement before they
  reach the per-aspect specs.
- **Pick one as sole authority.** Rejected: the two surfaces cover
  different content (rules of engagement vs substantive protocol
  claims) and conflating them would lose useful separation.
