# ADR-000: Source of truth and document precedence

## Status

Accepted (2026-05-30). Records the starting state of the repository.

## Context

The project has two reference documents at the root of the repository:

1. `CLAUDE.md` — a working build spec describing the project identity,
   coding standards, project structure, technology stack, transaction
   classes, wire protocol, peer-discovery architecture, card object model,
   timeout matrix, data model, Kafka event model, testing strategy,
   security model, API contracts, build order, error-handling philosophy,
   logging conventions, UI hierarchy, configuration, git workflow, open
   proof obligations, and "what NOT to build" lists.

2. `Formal_Architecture_Dealerless_Card_Game_BSV_v1.docx` — a formal
   architecture document covering Product, Protocol, Data Model, Threat
   Model, Transaction Model, APIs, Implementation Workstreams, and
   supporting specifications for BSV Script, concealed-deck cryptography,
   networking, and build sequence.

The two documents were authored together and substantially agree, but
they are written at different levels of detail and in different
registers. Without a stated precedence rule, contributors will draw
conflicting conclusions from minor differences in phrasing.

## Decision

Both documents are normative. Where they overlap and agree, the agreement
binds. Where they overlap and disagree, the following precedence rules
apply, in order:

1. **For rules of engagement and project hygiene** (coding standards,
   project structure, build order, what NOT to build, BSV-vs-BTC
   discipline, token-model statements, git workflow, error-handling
   philosophy, logging conventions, test categories, security-model
   high-level rules), `CLAUDE.md` is authoritative.

2. **For substantive protocol claims** (state machine, transaction
   classes, script semantics, timeout semantics, conflict-resolution
   rules, data-model fields, threat-model categories and named
   consequences, API contracts at the logical level, on-chain vs
   off-chain division, recovery rules), the Formal Architecture
   document is authoritative.

3. **For the canonical machine-readable form** of any object, the
   `protocol-types` package and the canonical serialisation in
   `spec/serialisation.md` are authoritative. Disagreements with prose
   in either document are reported as bugs against the prose.

4. **For test vectors and runtime behaviour**, `spec/test-vectors/` is
   authoritative. A test vector that disagrees with a prose claim is
   resolved by amending whichever the test author judges to be wrong,
   with the change recorded in a follow-up ADR.

Disagreements between the two reference documents that cannot be
resolved by the rules above must be filed as ADRs (`docs/adr/NNN-...`)
that name the disagreement, resolve it, and amend the relevant
document(s).

## Consequences

- New contributors have a single rule to apply when the two documents
  appear to differ.
- The repository carries both documents at the root so that the
  precedence rule is visible and so that DOCX-only readers (auditors,
  reviewers) and Markdown-only readers (engineers) both have a
  first-class entry point.
- The plaintext extract `docs/Formal_Architecture.txt` is provided so
  that `grep` and code-search tools can find references in the formal
  document without opening the binary DOCX.
- The phase status of the repository is tracked separately in
  `STATUS.md`.

## Alternatives considered

- **DOCX-only.** Rejected: contributors need a Markdown-first build
  spec and a CLI-greppable reference.
- **Convert DOCX to Markdown and discard the original.** Rejected: the
  DOCX is the artefact the architect signed off on; converting and
  discarding loses provenance.
- **Pick one document as sole authority.** Rejected: the two documents
  cover different surface areas (rules-of-engagement vs substantive
  architecture) and conflating them under one would lose useful
  separation.
