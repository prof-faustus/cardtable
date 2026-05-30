# PROJECT_SPEC.md — Dealerless Distributed Card-Game Application

## Project Identity

**Name:** Dealerless Distributed Card-Game Protocol  
**Codename:** `cardtable`  
**Type:** Transaction-native distributed state machine on BSV  
**First game:** In-Between (Acey-Deucey)  
**What this is:** A peer-to-peer, dealerless, non-custodial wagering platform where every game event is a BSV transaction, every card is a unique concealed tokenised object, and every failure mode has a precommitted deterministic resolution.  
**What this is NOT:** A casino app. A server-managed game. A wallet wrapper around betting. A collectible NFT marketplace. An account-based smart contract.

---

## Critical Rules — Read Before Every Task

### Truth and Integrity

- **Zero fabrication.** Every number, claim, and technical statement must be derived from a verifiable source or explicitly marked as an assumption.
- **Assumptions are defects.** If something is assumed, it must be stated, classified, and tracked. Hidden assumptions are treated as especially serious failures.
- **If you don't know, say "I don't know."** If you're not sure, say "I'm not sure." If verification is needed, say "I need to check."
- **Overclaims are defects.** Never state that the architecture guarantees something it only partially addresses.
- **Never pad, bluff, or sound confident without evidence.**

### BSV Specificity — CRITICAL

- **BSV and BTC are categorically distinct.** BSV/Teranode shares no codebase with Bitcoin Core. Any assumptions imported from BTC tooling, documentation, libraries, or conventions are WRONG and must not be made.
- **Use BSV SDKs only.** The BSV TypeScript SDK (for browser client) and BSV Go SDK (for backend services) are the authoritative chain-interaction libraries.
- **Script is Turing-complete on BSV.** Do not apply BTC script limitations (block size, opcode restrictions, standardness rules) to BSV.
- **Transaction cost is effectively negligible.** Do not design around block-space scarcity. Design around throughput (≥10⁶ TPS sustained) and bounded latency.
- **No SegWit. No Lightning. No Taproot.** These are BTC constructs. They do not exist on BSV.
- **SPV is the client verification model.** Not full-node validation. Use BUMP proofs, merkle proofs, and header chains.

### Token Model

- In-system tokens carry **no external monetary value**. This is not a regulated gambling service. Tokens are score within the game system. Do not introduce compliance, KYC/AML, or regulatory language unless explicitly requested.

---

## Architecture Overview

### The System in One Sentence

A multiplayer on-chain game in which concealed assets, player rights, and pot value are all represented by spendable contract objects (UTXOs), and the entire game progresses through signed, time-bounded, verifiable BSV transactions broadcast both to the network and directly to all table participants.

### Five Simultaneous Layers

1. **Wallet Layer** — Keys, signing, encrypted card decryption, local state verification
2. **Network Layer** — Dual-path: BSV network broadcast + direct player relay
3. **Game-State Layer** — Deterministic state machine: `State = f(valid_table_transactions)`
4. **Script/Contract Layer** — Every asset/right locked in scripts defining permitted transitions
5. **Cryptographic Secrecy Layer** — Cards as concealed tokenised objects with selective reveal

### The Central Principle

Every game state is a committed node in a transaction tree. From each node:
- Ordinary player action branches
- Timeout-triggered default branches
- Reveal or proof branches
- Settlement branches
- Recovery branches

**If the player acts, the game advances. If the player does not act, time activates a predefined default branch and the game advances anyway.**

---

## Technology Stack

### Client Application

```
Language:    TypeScript (strict mode, no `any`)
Framework:   React 18+
Build:       Vite
State:       Zustand (global game state) + React Context (UI-local)
Storage:     IndexedDB via Dexie.js (keys, table state, transcripts, encrypted cards)
Crypto:      Web Crypto API (SubtleCrypto) in secure contexts and Web Workers
Transport:   WebSocket (primary), WebRTC DataChannel (later, for direct peer paths)
Chain SDK:   BSV TypeScript SDK (@bsv/sdk)
Testing:     Vitest + React Testing Library + Playwright (e2e)
Styling:     Tailwind CSS (utility-first, no component libraries)
```

### Backend Services

```
Language:    Go 1.22+
Transport:   WebSocket server (gorilla/websocket or nhooyr.io/websocket)
Chain SDK:   BSV Go SDK
Persistence: Aerospike Enterprise Edition (materialised read paths)
Streaming:   Apache Kafka (event streaming, table event bus)
SPV:         BSV SPV Wallet / custom header-chain service
Protocol:    Binary wire protocol (compact, checksummed, versioned)
Testing:     Go standard testing + testify + custom adversarial harness
```

### Data Layer

```
Primary:     Aerospike EE (hot game state, player sessions, table indexes)
Event Bus:   Kafka (table events, action log, settlement events)
Chain:       BSV mainnet/testnet via SDK broadcasting + SPV proof retrieval
Local:       IndexedDB (client-side encrypted card vault and transcript cache)
```

### NOT in the Stack

- No PostgreSQL, MySQL, MongoDB, or any traditional RDBMS for game state
- No Redis (Aerospike covers this)
- No Firebase, Supabase, or managed BaaS
- No GraphQL (binary protocol for game wire, REST for admin/lobby APIs)
- No Next.js, Remix, or SSR framework (this is a client-heavy SPA)
- No Electron or Tauri (browser-first for v1)
- No Docker Compose for production (infrastructure is separate from application)

---

## Project Structure

```
cardtable/
├── PROJECT_SPEC.md                          # This file
├── README.md                          # Project overview and quickstart
│
├── spec/                              # Protocol specification (source of truth)
│   ├── state-machine.md               # Formal state machine definition
│   ├── tx-types.md                    # Transaction class definitions
│   ├── script-templates.md            # BSV script locking/unlocking templates
│   ├── timeout-rules.md               # Timeout semantics matrix
│   ├── recovery-rules.md              # Recovery and unwind semantics
│   ├── serialisation.md               # Canonical serialisation format
│   ├── ordering-rules.md              # Deterministic ordering for conflicts
│   ├── card-protocol.md               # Concealed deck construction and reveal
│   ├── wire-protocol.md               # Binary message format specification
│   ├── peer-discovery.md              # Bitcoin-style discovery + Bitmessage relay
│   └── test-vectors/                  # Canonical test cases
│       ├── valid-join.json
│       ├── invalid-join.json
│       ├── fold.json
│       ├── timeout-refund.json
│       ├── settlement.json
│       ├── double-spend-attempt.json
│       ├── reveal-proof.json
│       └── recovery.json
│
├── packages/                          # Shared protocol packages
│   ├── protocol-types/                # TypeScript: canonical type definitions
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── game.ts                # GameInstance, RoundState, RuleSet
│   │   │   ├── player.ts              # Player, WalletIdentity
│   │   │   ├── cards.ts               # ConcealedCard, DeckCommitment, RevealProof
│   │   │   ├── actions.ts             # SignedAction, ActionRequest, TimeoutBranch
│   │   │   ├── settlement.ts          # SettlementResult, RecoveryRecord
│   │   │   ├── transcript.ts          # AuditTranscript
│   │   │   ├── messages.ts            # Wire protocol message types
│   │   │   └── serialisation.ts       # Canonical serialisation/deserialisation
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── state-engine/                  # TypeScript: deterministic game logic
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── engine.ts              # Core: deriveState, applyAction, getLegalActions
│   │   │   ├── in-between.ts          # In-Between specific rules
│   │   │   ├── pot.ts                 # Pot accounting
│   │   │   ├── penalties.ts           # Penalty logic (consecutive/equal cards)
│   │   │   ├── timeout.ts            # Timeout eligibility computation
│   │   │   ├── ordering.ts            # Canonical ordering rules
│   │   │   ├── replay.ts             # Deterministic replay from transcript
│   │   │   └── validation.ts          # State transition validation
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── script-templates/              # TypeScript: BSV script construction
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── stake-lock.ts          # Player stake lock/unlock
│   │   │   ├── pot-lock.ts            # Pot custody script
│   │   │   ├── card-custody.ts        # Concealed card NFT custody
│   │   │   ├── fold-surrender.ts      # Fold without reveal
│   │   │   ├── reveal-proof.ts        # Reveal-or-timeout script
│   │   │   ├── settlement.ts          # Winner claim / split settlement
│   │   │   ├── recovery.ts            # Global recovery/unwind
│   │   │   └── timeout-branch.ts      # Lock-time branching patterns
│   │   ├── __tests__/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── crypto-cards/                  # TypeScript: card encryption/commitment
│       ├── src/
│       │   ├── index.ts
│       │   ├── entropy.ts             # Entropy generation and commitment
│       │   ├── shuffle.ts             # Deterministic shuffle from combined seed
│       │   ├── commitment.ts          # Card face commitment scheme
│       │   ├── encryption.ts          # Card encryption for concealed dealing
│       │   ├── reveal.ts              # Reveal proof generation and verification
│       │   ├── deck.ts                # Full deck lifecycle management
│       │   └── mental-poker.ts        # Layered encryption shuffle protocol
│       ├── __tests__/
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── client-web/                    # React browser application
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── wallet/            # Wallet creation, import, signing UI
│   │   │   │   ├── lobby/             # Table creation, join, seat display
│   │   │   │   ├── table/             # Live game table rendering
│   │   │   │   ├── cards/             # Card display, hand rendering
│   │   │   │   ├── timer/             # Countdown, timeout-default display
│   │   │   │   ├── signing/           # Transaction approval prompts
│   │   │   │   ├── settlement/        # Round result display
│   │   │   │   ├── recovery/          # Recovery status display
│   │   │   │   └── transcript/        # Audit log and replay viewer
│   │   │   ├── stores/
│   │   │   │   ├── wallet.ts          # Zustand: wallet/key state
│   │   │   │   ├── game.ts            # Zustand: game/table state
│   │   │   │   ├── cards.ts           # Zustand: encrypted card vault
│   │   │   │   └── network.ts         # Zustand: connection/peer state
│   │   │   ├── services/
│   │   │   │   ├── wallet.ts          # Key management, signing, Web Crypto
│   │   │   │   ├── transport.ts       # WebSocket connection management
│   │   │   │   ├── relay.ts           # Direct peer transaction relay
│   │   │   │   ├── chain.ts           # BSV SDK: broadcast, status, SPV
│   │   │   │   ├── state-sync.ts      # Local state derivation from txs
│   │   │   │   └── card-vault.ts      # IndexedDB encrypted card storage
│   │   │   ├── hooks/
│   │   │   │   ├── useGame.ts
│   │   │   │   ├── useWallet.ts
│   │   │   │   ├── useTimer.ts
│   │   │   │   ├── useCards.ts
│   │   │   │   └── usePeers.ts
│   │   │   └── lib/
│   │   │       ├── constants.ts
│   │   │       └── utils.ts
│   │   ├── public/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── relay-go/                      # Go: relay/sequencer service
│   │   ├── cmd/
│   │   │   └── relay/
│   │   │       └── main.go
│   │   ├── internal/
│   │   │   ├── relay/                 # WebSocket relay, table-local fanout
│   │   │   ├── session/               # Table session lifecycle
│   │   │   ├── ordering/              # Action ordering within rounds
│   │   │   ├── timeout/               # Timeout detection and default tx construction
│   │   │   ├── broadcast/             # BSV network broadcast
│   │   │   └── metrics/               # Telemetry and observability
│   │   ├── pkg/
│   │   │   ├── protocol/              # Wire protocol encoding/decoding
│   │   │   ├── types/                 # Go equivalents of protocol-types
│   │   │   └── engine/                # Go port of state-engine (verification)
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   ├── indexer-go/                    # Go: table/tx indexing service
│   │   ├── cmd/
│   │   │   └── indexer/
│   │   │       └── main.go
│   │   ├── internal/
│   │   │   ├── indexer/               # Mempool + block observation
│   │   │   ├── table/                 # Table state projection
│   │   │   ├── card/                  # Card lineage tracking
│   │   │   ├── store/                 # Aerospike persistence
│   │   │   └── api/                   # Query APIs for clients
│   │   ├── go.mod
│   │   └── go.sum
│   │
│   └── spv-service-go/               # Go: SPV proof and header service
│       ├── cmd/
│       │   └── spv/
│       │       └── main.go
│       ├── internal/
│       │   ├── headers/               # Block header chain management
│       │   ├── proofs/                # BUMP/Merkle proof retrieval
│       │   ├── status/                # Transaction status tracking
│       │   └── api/
│       ├── go.mod
│       └── go.sum
│
├── tests/
│   ├── integration/                   # Cross-service integration tests
│   ├── simulation/                    # Multi-player game simulation
│   ├── adversarial/                   # Malicious-peer scenario tests
│   │   ├── disconnect_scenarios_test.go
│   │   ├── stale_action_test.go
│   │   ├── timeout_race_test.go
│   │   ├── withheld_reveal_test.go
│   │   ├── duplicate_message_test.go
│   │   ├── invalid_branch_test.go
│   │   ├── conflicting_spend_test.go
│   │   ├── mempool_eviction_test.go
│   │   └── recovery_branch_test.go
│   └── replay/                        # Deterministic replay verification
│
├── tools/
│   ├── tx-simulator/                  # Transaction graph simulator
│   ├── deck-simulator/                # Deterministic deck/reveal simulator
│   └── transcript-verifier/           # Audit transcript verification tool
│
└── docs/
    ├── architecture.md                # Architecture overview
    ├── adr/                           # Architecture Decision Records
    │   ├── 001-utxo-not-account.md
    │   ├── 002-aerospike-not-postgres.md
    │   ├── 003-binary-wire-protocol.md
    │   ├── 004-dual-path-propagation.md
    │   ├── 005-commitment-deck-first.md
    │   └── 006-websocket-before-webrtc.md
    └── runbooks/
        ├── local-dev.md
        └── deployment.md
```

---

## Coding Standards

### TypeScript (Client + Shared Packages)

```typescript
// tsconfig.json base settings — MANDATORY
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "sourceMap": true
  }
}
```

**Rules:**

- **No `any`.** Ever. Use `unknown` and narrow with type guards.
- **No type assertions (`as`)** unless the alternative is a runtime check that adds no safety. Each assertion requires a comment justifying why.
- **Exhaustive switch/if-else.** Every discriminated union must be handled exhaustively with a `never` default.
- **Result types over exceptions.** Use `{ ok: true, value: T } | { ok: false, error: E }` for operations that can fail. Exceptions are for programmer errors only.
- **Branded types for IDs.** `type GameId = string & { readonly __brand: 'GameId' }`. Never pass a raw string where a typed ID is expected.
- **All public functions documented.** JSDoc with `@param`, `@returns`, `@throws` (if applicable). No bare exports.
- **No default exports.** Named exports only.
- **Imports ordered:** external libs → shared packages → relative imports, separated by blank lines.
- **No barrel exports in deeply nested modules.** Only at package root `index.ts`.
- **`readonly` by default.** Mutable state must be explicitly justified.
- **No classes unless they encapsulate mutable state with invariants.** Prefer functions, modules, and plain objects.

### Go (Backend Services)

```go
// Effective Go + project conventions
```

**Rules:**

- **Standard Go project layout.** `cmd/`, `internal/`, `pkg/`.
- **`internal/` for service-private code.** `pkg/` only for code shared across Go services.
- **Errors are values.** Always handle errors. Never `_ = err`. Use `fmt.Errorf("context: %w", err)` for wrapping.
- **No `panic` in library code.** `panic` only in `main()` or test helpers.
- **Context everywhere.** Every function that does I/O or can be cancelled takes `context.Context` as first parameter.
- **Structured logging.** Use `slog` (Go 1.21+). No `fmt.Println` for logs.
- **No global mutable state.** Dependency injection via constructor functions.
- **Table-driven tests.** Every test function uses subtests.
- **Interfaces at the consumer.** Define interfaces where they are used, not where they are implemented.
- **Channel direction.** Always specify `chan<-` or `<-chan` in function signatures.
- **Graceful shutdown.** Every service handles `SIGTERM`/`SIGINT` and drains in-flight work.

### Shared Conventions

- **One concern per file.** If a file exceeds 300 lines, it probably does too much.
- **No commented-out code.** Delete it. Git has history.
- **No TODO without a tracking reference.** `// TODO(cardtable#42): handle edge case` or don't write it.
- **Semantic commit messages.** `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- **Branch naming.** `feat/table-creation`, `fix/timeout-race`, `refactor/state-engine`.

---

## State Machine Specification

### Game State Object

Every state must commit to:

```typescript
interface RoundState {
  readonly gameId: GameId;
  readonly ruleSetHash: Hash256;
  readonly players: ReadonlyArray<PlayerState>;
  readonly activePlayerIndex: number;
  readonly roundNumber: number;
  readonly potValue: Satoshis;
  readonly visibleCards: ReadonlyArray<RevealedCard>;
  readonly hiddenCardCommitments: ReadonlyArray<CardCommitment>;
  readonly allowedActions: ReadonlyArray<ActionType>;
  readonly timeoutParams: TimeoutParams;
  readonly defaultAction: ActionType;
  readonly successorTemplates: ReadonlyArray<TxTemplate>;
  readonly stateHash: Hash256;
}
```

### State Transitions for In-Between

```
TABLE_OPEN
  → PLAYER_JOIN (repeated until seat count met)
    → TABLE_LOCK
      → ENTROPY_COMMIT (each player)
        → ENTROPY_REVEAL (each player)
          → DECK_COMMIT
            → CARD_REVEAL_1 (first visible card)
              → CARD_REVEAL_2 (second visible card)
                → DECISION_WINDOW
                  ├── BET_ACTION (player bets)
                  │     → CARD_REVEAL_3 (third card)
                  │       ├── WIN_SETTLEMENT
                  │       ├── LOSS_SETTLEMENT
                  │       └── PENALTY_SETTLEMENT
                  ├── PASS_ACTION (player passes)
                  │     → NEXT_PLAYER
                  └── TIMEOUT_DEFAULT (decision timeout fires)
                        → PASS_DEFAULT → NEXT_PLAYER
                → NEXT_PLAYER
                  → CARD_REVEAL_1 (next round, rotated)
      → DECK_TIMEOUT (entropy reveal stalled)
        → RECOVERY
  → TABLE_CLOSE
```

### Every State Has Two Branches

```
┌─────────────────────────┐
│    ACTIONABLE STATE     │
├─────────────────────────┤
│                         │
│  LIVE BRANCH            │  ← Player acts before deadline
│  (ordinary action tx)   │
│                         │
│  DEAD-MAN BRANCH        │  ← Lock-time activates after deadline
│  (timeout default tx)   │
│                         │
│  RECOVERY BRANCH        │  ← Longer lock-time for deep failures
│  (unwind/refund tx)     │
│                         │
└─────────────────────────┘
```

---

## Transaction Model

### Transaction Classes

| Class | BSV Opcode Requirements | Lock-Time |
|-------|------------------------|-----------|
| `TABLE_CREATE` | `OP_CHECKSIG` | None |
| `TABLE_JOIN` | `OP_CHECKSIG`, `OP_HASH160` | None |
| `TABLE_LOCK` | `OP_CHECKMULTISIG` | None |
| `ENTROPY_COMMIT` | `OP_CHECKSIG`, `OP_SHA256`, `OP_EQUAL` | None |
| `ENTROPY_REVEAL` | `OP_SHA256`, `OP_EQUALVERIFY`, `OP_CHECKSIG` | None |
| `DECK_COMMIT` | `OP_CHECKSIG`, `OP_HASH256` | None |
| `CARD_DEAL` | `OP_CHECKSIG`, `OP_HASH160` | None |
| `BET_ACTION` | `OP_CHECKSIG` | None |
| `PASS_ACTION` | `OP_CHECKSIG` | None |
| `TIMEOUT_DEFAULT` | `OP_CHECKLOCKTIMEVERIFY`, `OP_CHECKSIG` | Short (30s–2min) |
| `CARD_REVEAL` | `OP_SHA256`, `OP_EQUALVERIFY` | None |
| `FOLD` | `OP_CHECKSIG` (no reveal required) | None |
| `SETTLEMENT` | `OP_CHECKMULTISIG` or `OP_CHECKSIG` | None |
| `RECOVERY` | `OP_CHECKSEQUENCEVERIFY`, `OP_CHECKSIG` | Long (10–30min) |
| `TABLE_CLOSE` | `OP_CHECKSIG` | None |

### Script Template Pattern

```
// Conceptual pot-lock script
IF
  // Cooperative path: all required signatures
  <N> <PubKey1> ... <PubKeyN> <N> OP_CHECKMULTISIG
ELSE
  IF
    // Winner claim path: valid reveal proof + winner signature
    OP_SHA256 <expected_hash> OP_EQUALVERIFY
    <WinnerPubKey> OP_CHECKSIG
  ELSE
    // Timeout refund path: after lock-time, anyone can trigger refund
    <timeout_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
    <RefundPubKey> OP_CHECKSIG
  ENDIF
ENDIF
```

### Pre-Signed Fallback Graph

Before play begins, ALL players must sign fallback transactions for:

1. Table abort refund (no quorum)
2. Deck-build timeout unwind
3. Deal timeout unwind
4. Action timeout default (per-state)
5. Reveal timeout forfeit
6. Settlement timeout
7. Table closure refund
8. Global recovery unwind

**Every fallback tx uses `OP_CHECKLOCKTIMEVERIFY` or `OP_CHECKSEQUENCEVERIFY`.**

---

## Wire Protocol

### Message Frame

```
┌──────────┬─────────┬──────────┬────────────┬──────────┬─────────┐
│ Magic(4) │ Ver(2)  │ Type(2)  │ Length(4)  │ Chksum(4)│Payload  │
└──────────┴─────────┴──────────┴────────────┴──────────┴─────────┘
```

- **Magic:** `0x43415244` ("CARD")
- **Version:** Protocol version (major.minor as uint16)
- **Type:** Message type enum
- **Length:** Payload length in bytes
- **Checksum:** First 4 bytes of SHA-256 of payload
- **Payload:** Binary-encoded message body

### Discovery Messages (Bitcoin-style)

| Type | Code | Purpose |
|------|------|---------|
| `VERSION` | `0x0001` | Handshake initiation |
| `VERACK` | `0x0002` | Handshake acknowledgement |
| `PING` | `0x0003` | Liveness check |
| `PONG` | `0x0004` | Liveness response |
| `GETADDR` | `0x0005` | Request peer addresses |
| `ADDR` | `0x0006` | Advertise peer addresses |

### Object Relay Messages (Bitmessage-style)

| Type | Code | Purpose |
|------|------|---------|
| `INV` | `0x0100` | Advertise known object hashes |
| `GETDATA` | `0x0101` | Request objects by hash |
| `OBJECT` | `0x0102` | Deliver requested object |
| `NOTFOUND` | `0x0103` | Object not available |
| `REJECT` | `0x0104` | Object rejected with reason |

### Game Object Types

| Type | Code | Description |
|------|------|-------------|
| `TABLE_ANNOUNCE` | `0x0200` | Table advertisement |
| `SEAT_COMMIT` | `0x0201` | Player seat reservation |
| `TABLE_START` | `0x0202` | Table locked, play begins |
| `ACTION_COMMIT` | `0x0203` | Committed action hash |
| `ACTION_REVEAL` | `0x0204` | Revealed action + salt |
| `ROUND_RESULT` | `0x0205` | Round outcome |
| `TRANSCRIPT_HASH` | `0x0206` | Transcript checkpoint |
| `TABLE_CLOSE` | `0x0207` | Table terminated |
| `TIMEOUT_NOTICE` | `0x0208` | Timeout activation alert |

### Streams (Bitmessage-style)

- `LOBBY` — global table advertisements
- `GAME_TYPE:<type>` — game-type specific discovery
- `TABLE:<table_id>` — table-specific action relay

---

## Peer Discovery Architecture

### Two-Tier Model

**Tier A — Discovery Network (Bitcoin-style):**
- `version` / `verack` handshake with capabilities bitfield
- `getaddr` / `addr` for peer address gossip
- Peer store with buckets: tried, new, suspicious, table-host, lightweight
- Peer scoring: successful handshakes, timeout rate, invalid objects, latency, table completion

**Tier B — Game Object Network (Bitmessage-style):**
- `inv` / `getdata` / `object` for application-layer payload relay
- Stream-scoped propagation (lobby stream, game-type stream, table-specific stream)
- Typed objects: TABLE_ANNOUNCE, SEAT_COMMIT, TABLE_START, ACTION_COMMIT, etc.

### Bootstrap

- Hardcoded seed nodes
- DNS seeds (controlled)
- Cached peer database from prior sessions
- Manual peer entry (testing/development)

### Critical Rule: Gossip for Discovery, Direct Channels for Play

- **P2P gossip** for: finding peers, discovering tables, fetching transcripts, redundancy
- **Direct or semi-direct channels** for: live game actions, commit/reveal phases, timing-sensitive rounds

---

## Card Object Model

### Card as Tokenised UTXO

```typescript
interface ConcealedCard {
  readonly cardId: CardId;           // Unique within deck
  readonly deckId: DeckId;           // Which deck this belongs to
  readonly cardSerial: number;       // Position in canonical deck (0-51)
  readonly faceCommitment: Hash256;  // H(rank || suit || cardNonce)
  readonly ciphertext: Uint8Array;   // Encrypted face value
  readonly custodyScript: Script;    // Current locking script
  readonly lifecycleState: CardLifecycleState;
}

type CardLifecycleState =
  | 'UNDEALT'           // In deck pool, encrypted, unassigned
  | 'ASSIGNED_CONCEALED' // In player hand, only holder can decrypt
  | 'REVEALED'           // Plaintext proven at showdown
  | 'SURRENDERED'        // Folded — returned without reveal
  | 'RETIRED';           // Round complete, card inactive
```

### Concealed Deck Construction (Mental Poker Model)

```
Phase A: Canonical deck definition (52 ordered card objects)
Phase B: Commitment of card identities (H(face || nonce) per card)
Phase C: Layered encryption by all participants
         Each player applies secret permutation + encryption layer
Phase D: Final deck commitment (DECK_LOCK transaction)
Phase E: Card extraction (deal concealed objects to player hand UTXOs)
Phase F: Selective decryption (encryption layers removed for recipient only)
Phase G: Local open (recipient wallet decrypts face privately)
```

### Fold: Surrender Without Reveal

A fold transaction MUST:
1. Prove the player controls the concealed hand objects
2. Transfer them to dead-hand / surrendered state
3. Preserve all encryption (face remains hidden)
4. Remove the player from live contention

A fold transaction MUST NOT:
1. Reveal any card face
2. Leak any information about card identity
3. Require cooperation from other players

---

## Timeout Matrix

| State | Decision Timeout | Default Action | Recovery Timeout | Recovery Action |
|-------|-----------------|----------------|-----------------|-----------------|
| `ENTROPY_COMMIT` | 60s | Excluded from shuffle | 5min | Table abort, refund all |
| `ENTROPY_REVEAL` | 60s | Penalised, fallback seed | 5min | Table abort, refund all |
| `BET_DECISION` | 30s–120s (configurable) | Pass (no bet) | 10min | Recovery unwind |
| `CARD_REVEAL` | 60s | Reveal timeout penalty | 10min | Recovery unwind |
| `SETTLEMENT` | 120s | Auto-settle from committed state | 15min | Recovery unwind |
| `SHOWDOWN_REVEAL` | 60s | Forfeit (treated as fold) | 10min | Recovery unwind |
| `GENERAL_STALL` | N/A | N/A | 30min | Full table unwind to last valid state |

---

## Double-Spend and Conflict Handling

### Three Layers of Defence

**Layer 1 — Table-Local Outpoint Discipline:**
- One spendable action right per phase per player
- Any conflicting spend is invalid for table progression once one is accepted

**Layer 2 — Deterministic Phase Selection:**
The table rules define which candidate counts if multiple are seen:
- First valid spend seen by quorum of peers
- OR lowest txid among valid phase-conflicts after timeout
- OR first one referenced by the next accepted state transition

**Layer 3 — Pre-Signed Penalty/Timeout Branches:**
- Timeout path activates on conflict or disappearance
- Default action is forced
- Funds become partially slashable by pre-agreed script

### Mempool Considerations

- Mempool contents can change; transactions can be evicted
- The table system MUST maintain its own table-level direct rebroadcast
- The table system MUST maintain its own peer visibility tracking
- The table system MUST have phase-closing rules
- The table system MUST be able to resubmit missing transactions

---

## Aerospike Data Model

### Namespaces and Sets

```
Namespace: cardtable

Sets:
  tables          — Table metadata and lifecycle
  players         — Player sessions and identity
  rounds          — Round state snapshots
  cards           — Card lineage and custody
  actions         — Action log (append-only)
  transcripts     — Audit transcript checkpoints
  timeouts        — Active timeout tracking
  settlements     — Settlement records
  peers           — Peer discovery state
```

### Key Design Principles

- **Aerospike is the materialised read path.** The source of truth is the transaction graph.
- **Write-behind from Kafka.** Events flow through Kafka and are materialised to Aerospike.
- **TTL on ephemeral data.** Table sessions, peer state expire. Transcripts persist.
- **No joins.** Every query is a single-key or single-set scan. Denormalise aggressively.
- **Strong consistency mode** for settlement records and card custody. Eventually consistent for everything else.

---

## Kafka Event Model

### Topics

```
cardtable.table.lifecycle     — TABLE_CREATE, TABLE_LOCK, TABLE_CLOSE
cardtable.table.actions       — All player actions within a table
cardtable.table.settlements   — Settlement events
cardtable.table.timeouts      — Timeout activations
cardtable.deck.commits        — Deck construction events
cardtable.deck.reveals        — Card reveal events
cardtable.network.broadcast   — Transactions broadcast to BSV
cardtable.network.status      — Transaction confirmation status updates
```

### Partitioning

- Partition by `tableId` — all events for a table go to the same partition
- Guarantees ordering within a table
- Enables parallel processing across tables

### Consumer Groups

- `indexer` — materialises to Aerospike
- `auditor` — builds audit transcripts
- `timeout-watcher` — monitors for timeout activation
- `rebroadcaster` — resubmits missing transactions

---

## Testing Strategy

### Test Categories

| Category | Tool | What it Tests |
|----------|------|---------------|
| Unit (TS) | Vitest | State engine, script templates, serialisation, crypto |
| Unit (Go) | Go test | Relay logic, protocol encoding, timeout detection |
| Integration | Vitest + Go test | Client ↔ relay ↔ chain flow |
| E2E | Playwright | Full game flow in browser |
| Simulation | Custom harness | Multi-player game scenarios |
| Adversarial | Custom harness | All threat-model scenarios |
| Replay | Custom harness | Deterministic replay verification |
| Script | BSV SDK | Script template execution and validation |

### Adversarial Test Scenarios (MANDATORY before any release)

1. **Disconnect before funding** — verify clean abort and refund
2. **Disconnect after funding, before shuffle** — verify timeout unwind
3. **Withheld entropy reveal** — verify fallback seed or exclusion
4. **Disconnect before betting** — verify pass default after timeout
5. **Disconnect after betting, before card reveal** — verify reveal timeout
6. **Stale action after timeout expiry** — verify rejection
7. **Two clients disagree on timeout canonicity** — verify deterministic resolution
8. **Settlement broadcast delayed** — verify recovery path
9. **Reconnect with obsolete state** — verify state sync
10. **Duplicate message propagation** — verify idempotency
11. **Conflicting action transactions (double-spend)** — verify single accepted action
12. **Mempool eviction** — verify rebroadcast and recovery
13. **Fee miscalculation** — verify graceful handling
14. **All players disconnect** — verify global recovery unwind

### Test Vectors

Every test vector in `spec/test-vectors/` must include:
- Input state (serialised canonical form)
- Action or event
- Expected output state
- Expected transactions generated
- Expected error (if invalid)

The state engine in both TypeScript and Go must produce identical results for all test vectors.

---

## Security Model

### Key Architecture

| Key Type | Purpose | Storage | Derivation |
|----------|---------|---------|------------|
| Value-signing key | Authorise stake movement and settlement | IndexedDB (encrypted) | HD wallet root |
| Session key | Authenticated peer messaging | Memory (per session) | Derived per table |
| Encryption key | Card concealment and reveal | IndexedDB (encrypted) | Derived per deck |
| Recovery key | Wallet backup and restoration | User-exported | HD wallet root |

### Signing Flow

Every signature prompt in the UI must display:
1. What is being signed (human-readable)
2. The economic consequence (how much value is at risk)
3. The timeout/default behaviour that applies
4. Whether this is reversible

**Never sign silently.** This is a financial application.

### What Must Be On-Chain vs Off-Chain

| On-Chain (enforceable) | Off-Chain (coordination) |
|----------------------|------------------------|
| Funding and pot locking | Rule agreement |
| Commitment anchoring | Entropy commitment exchange |
| Timeout branch execution | Action proposal |
| Settlement | Transaction template exchange |
| Recovery | Signature coordination |
| Card custody transfers | Timer observation |
| Fold surrender | Local state derivation |

---

## API Contracts

### Client ↔ Relay (WebSocket)

```typescript
// Client sends
type ClientMessage =
  | { type: 'JOIN_TABLE'; tableId: TableId; playerIdentity: PlayerIdentity }
  | { type: 'READY'; tableId: TableId }
  | { type: 'ACTION'; tableId: TableId; action: SignedAction }
  | { type: 'COMMITMENT'; tableId: TableId; commitment: EntropyCommitment }
  | { type: 'REVEAL'; tableId: TableId; reveal: EntropyReveal }
  | { type: 'CARD_REVEAL'; tableId: TableId; reveal: CardRevealProof }
  | { type: 'FOLD'; tableId: TableId; fold: FoldSurrender }
  | { type: 'TRANSCRIPT_REQUEST'; tableId: TableId; fromState: Hash256 }
  | { type: 'PING' };

// Relay sends
type RelayMessage =
  | { type: 'TABLE_STATE'; state: RoundState }
  | { type: 'ACTION_ACCEPTED'; action: SignedAction }
  | { type: 'TIMEOUT_NOTICE'; stateHash: Hash256; defaultAction: ActionType }
  | { type: 'SETTLEMENT'; result: SettlementResult }
  | { type: 'RECOVERY_ACTIVATED'; record: RecoveryRecord }
  | { type: 'PEER_ACTION'; action: SignedAction }  // Relayed from another player
  | { type: 'TRANSCRIPT_RESPONSE'; entries: ReadonlyArray<TranscriptEntry> }
  | { type: 'ERROR'; code: ErrorCode; message: string }
  | { type: 'PONG' };
```

### Relay ↔ Indexer (Kafka)

Events published to Kafka topics as defined in the Kafka Event Model section.

### Client ↔ Chain (BSV SDK)

```typescript
// Via BSV TypeScript SDK
interface ChainService {
  broadcastTransaction(tx: Transaction): Promise<BroadcastResult>;
  getTransactionStatus(txId: TxId): Promise<TxStatus>;
  getOutputStatus(outpoint: Outpoint): Promise<OutputStatus>;
  getMerkleProof(txId: TxId): Promise<MerkleProof | null>;
}
```

---

## Build Order — What to Build When

### Phase 1: Protocol Specification (Week 1–2)

Write spec documents. No code yet.

- `spec/state-machine.md` — complete state machine
- `spec/tx-types.md` — all transaction classes
- `spec/script-templates.md` — all script patterns
- `spec/timeout-rules.md` — timeout matrix
- `spec/serialisation.md` — canonical format
- `spec/ordering-rules.md` — conflict resolution
- `spec/test-vectors/` — at least 8 test vectors
- `packages/protocol-types/` — TypeScript type definitions only

### Phase 2: State Engine + Script Templates (Week 3–4)

- `packages/state-engine/` — deterministic rules engine
- `packages/script-templates/` — BSV script construction
- Unit tests against all test vectors
- Go port of state engine in `apps/relay-go/pkg/engine/`

### Phase 3: Open-Information Prototype (Week 5–6)

No concealed cards. Prove the transaction flow.

- `apps/client-web/` — basic lobby, table, signing UI
- `apps/relay-go/` — WebSocket relay, action ordering, timeout
- Table creation → join → lock → bet → settlement → close
- Timeout refund path
- Direct relay + network broadcast

### Phase 4: Concealed Single-Card (Week 7–8)

- `packages/crypto-cards/` — entropy, commitment, encryption, reveal
- One encrypted card object per player
- Private local decryption
- Reveal with proof
- Fold surrender without reveal
- Timeout unwind

### Phase 5: Multi-Card In-Between (Week 9–10)

- Full In-Between protocol: pot, two visible cards, bet, third card, settlement
- Rotation of active player
- Penalty logic (consecutive/equal cards)
- Pre-signed fallback graph
- Transcript replay

### Phase 6: Adversarial Testing + Hardening (Week 11–12)

- All 14 adversarial scenarios
- Mempool eviction recovery
- Reconnect with stale state
- Duplicate message handling
- End-to-end deterministic replay
- Telemetry and observability

---

## Error Handling Philosophy

### Client

```typescript
// Result type — MANDATORY for all fallible operations
type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// Usage
function parseAction(raw: unknown): Result<SignedAction, ParseError> {
  // ...
}

// Handling
const result = parseAction(data);
if (!result.ok) {
  logger.error('Failed to parse action', { error: result.error });
  return;
}
const action = result.value; // TypeScript narrows correctly
```

### Go

```go
// Always wrap errors with context
func (s *Session) processAction(ctx context.Context, action Action) error {
    if err := s.validate(ctx, action); err != nil {
        return fmt.Errorf("validate action %s: %w", action.ID, err)
    }
    // ...
}

// Sentinel errors for known failure modes
var (
    ErrTableFull       = errors.New("table full")
    ErrTimeoutExpired  = errors.New("timeout expired")
    ErrInvalidAction   = errors.New("invalid action for current state")
    ErrStaleState      = errors.New("action references stale state")
    ErrDoubleSpend     = errors.New("conflicting action already accepted")
)
```

---

## Logging and Observability

### Structured Logging Fields

Every log entry for a table event MUST include:

```json
{
  "table_id": "...",
  "round_number": 3,
  "phase": "BET_DECISION",
  "player_id": "...",
  "action_type": "BET",
  "state_hash": "...",
  "timestamp_ms": 1714000000000,
  "latency_ms": 12
}
```

### Metrics (Prometheus-compatible)

```
cardtable_tables_active                    gauge
cardtable_tables_created_total             counter
cardtable_rounds_completed_total           counter
cardtable_actions_processed_total          counter  {type="bet|pass|fold|timeout"}
cardtable_timeouts_activated_total         counter  {type="decision|recovery"}
cardtable_settlements_completed_total      counter  {outcome="win|loss|penalty|refund"}
cardtable_tx_broadcast_total               counter  {status="accepted|rejected|double_spend"}
cardtable_tx_broadcast_latency_seconds     histogram
cardtable_relay_message_latency_seconds    histogram
cardtable_peer_connections_active          gauge
cardtable_state_derivation_latency_seconds histogram
```

---

## UI Component Hierarchy

```
App
├── WalletGate (requires wallet before proceeding)
│   ├── WalletCreate
│   └── WalletImport
├── Lobby
│   ├── TableList
│   ├── TableCreate (rule config, stake config)
│   └── TableJoin
├── Table
│   ├── PlayerBar (seats, names, balances, status)
│   ├── PotDisplay
│   ├── CardArea
│   │   ├── VisibleCards (face-up community cards)
│   │   └── PlayerHand (concealed, locally decrypted)
│   ├── ActionPanel
│   │   ├── BetControls (slider, min/max, confirm)
│   │   ├── PassButton
│   │   └── FoldButton
│   ├── TimerBar (countdown, default action indicator)
│   ├── SigningPrompt (modal: what, cost, consequence)
│   └── ResultOverlay (win/loss/penalty display)
├── Recovery
│   ├── RecoveryStatus
│   └── RefundDisplay
└── Transcript
    ├── TranscriptViewer
    └── ReplayControls
```

### UI Safety Rules

- **Never sign silently.** Every transaction that moves value requires explicit user approval with consequence display.
- **Always show timeout default.** "If you do nothing, your action will default to [X] in [Y] seconds."
- **Always show economic consequence.** "This bet risks [X] tokens from your stake."
- **Always show committed state.** "This round is now committed and cannot be altered."
- **Show recovery status.** "Recovery branch will activate in [Y] if settlement is not completed."

---

## Configuration

### Environment Variables

```bash
# Client (build-time via Vite)
VITE_RELAY_WS_URL=wss://relay.cardtable.example/ws
VITE_BSV_NETWORK=mainnet|testnet
VITE_BSV_BROADCAST_URL=https://api.whatsonchain.com/v1/bsv/main/tx/raw

# Relay Service
RELAY_LISTEN_ADDR=:8080
RELAY_AEROSPIKE_HOSTS=aerospike-1:3000,aerospike-2:3000
RELAY_KAFKA_BROKERS=kafka-1:9092,kafka-2:9092
RELAY_BSV_NETWORK=mainnet
RELAY_DECISION_TIMEOUT_DEFAULT=60s
RELAY_RECOVERY_TIMEOUT_DEFAULT=600s
RELAY_MAX_TABLES=10000
RELAY_MAX_PLAYERS_PER_TABLE=8
RELAY_LOG_LEVEL=info

# Indexer Service
INDEXER_LISTEN_ADDR=:8081
INDEXER_AEROSPIKE_HOSTS=aerospike-1:3000
INDEXER_KAFKA_BROKERS=kafka-1:9092
INDEXER_KAFKA_CONSUMER_GROUP=indexer

# SPV Service
SPV_LISTEN_ADDR=:8082
SPV_HEADER_CHAIN_DB=/data/headers.db
SPV_BSV_PEER=seed.bitcoinsv.io:8333
```

---

## Git Workflow

- `main` — production-ready, protected, requires PR review
- `develop` — integration branch, CI must pass
- `feat/*` — feature branches from `develop`
- `fix/*` — bugfix branches
- `release/*` — release preparation

### PR Requirements

- All tests pass
- No `any` in TypeScript diff
- No unhandled errors in Go diff
- State engine changes require matching test vector updates
- Script template changes require matching script execution tests
- Adversarial test coverage for any new state transition

---

## Open Proof Obligations

The following are formally identified as hard prerequisites. They must be resolved before any private-hand game ships:

1. **Formal security analysis of the multiparty concealed-deck construction.** The mental-poker-style layered encryption must be proven secure against collusion attacks where N-1 of N players cooperate.
2. **Proof that the commit-reveal shuffle produces a uniform distribution.** The combined entropy derivation must not be biasable by the last revealer.
3. **Proof that the timeout recovery path cannot leak card information.** When a player disappears mid-reveal, the recovery process must not reveal concealed cards to remaining players.
4. **Formal verification of all script templates.** Every script branch must be tested for: valid spend, invalid spend rejection, timeout activation, and branch interaction.
5. **Double-spend resistance proof for the deterministic conflict resolution rule.** The chosen ordering rule must be shown to be consistent across all honest peers under reasonable network assumptions.

---

## What NOT to Build

- No house token or governance token
- No cosmetic NFT marketplace
- No regulatory/compliance layer (tokens have no external value)
- No chat system (out of scope)
- No social features (out of scope)
- No mobile native apps (browser-first)
- No server-side game state (state is derived from transactions)
- No account-based balance model (UTXO only)
- No BTC/Lightning/Taproot anything
- No "decentralised" ideology in documentation or code
- No GraphQL
- No ORM (Aerospike driver directly)

---

## Reference Documents

- `spec/` directory is the source of truth for protocol behaviour
- The formal architecture document (DOCX) is the high-level architecture reference
- The Cassandra schema (`wallet_bonus_cassandra_schema.cql`) is reference material from the iGaming POC project — NOT part of this system's data model
- The Database Technical Profiles PDF is reference material for the iGaming platform context — NOT the technology stack for this project
- ADRs in `docs/adr/` document all significant design decisions with rationale

---

## Reminders for Every Session

1. **BSV is not BTC.** Check every library, opcode reference, and assumption.
2. **The state engine is deterministic.** `State = f(valid_table_transactions)`. If it produces different results for the same inputs, it is broken.
3. **Every state has a timeout branch.** No exceptions. No "we'll handle that later."
4. **Every transaction is sent both to the network and directly to peers.** Dual-path propagation is not optional.
5. **Folding does not reveal cards.** Ever.
6. **The UI must show consequences, not just state.** Every timer, every default, every economic risk.
7. **Test vectors are the contract.** TypeScript and Go must produce identical results.
8. **The spec comes first.** Do not write implementation code for a state transition that is not specified.
9. **Tokens have no external value.** Do not introduce compliance language.
10. **No hardcoded numbers without derivation.** Every constant must trace to the spec or a documented source.
