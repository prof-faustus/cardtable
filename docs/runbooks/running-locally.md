# Running cardtable locally

Three modes, in increasing infrastructure cost.

## 1. Pure-process dev (no Docker, no BSV node)

The fastest loop. Run the TS unit suites against the in-process engine; no
real network involved.

```bash
pnpm install
pnpm ci   # workspace build + every package's test
```

Run the Go suite too:

```bash
cd apps/relay-go
go mod tidy   # populates go.sum from go.mod
go test -v ./...
```

The browser client's offline mode also works without a relay:

```bash
pnpm --filter @cardtable/client-web dev   # http://localhost:5173
# Click any seat / lock / commit button — the in-process state engine
# advances S1 -> S3 -> S4 -> ... -> S10.
```

## 2. Relay-bound dev (live binary, no chain)

Build the Go relay and drive it from the browser or the integration tests.
No BSV node needed; the relay's chain-height callback uses the static
`--start-height` fallback.

```bash
# Build
cd apps/relay-go
go mod tidy
go build -o ../../bin/relay ./cmd/relay

# Run
./bin/relay \
  --addr :8080 --ws-addr :8081 \
  --game 00000000000000000000000000000000000000000000000000000000000000aa \
  --start-height 100
```

Drive it from a browser:

```bash
cd apps/client-web
pnpm vite build && pnpm vite preview --port 4173
# open http://localhost:4173 and click "Connect to relay"
```

Or run the live integration tests:

```bash
CARDTABLE_RUN_LIVE=1 \
CARDTABLE_RUN_FULL_ROUND=1 \
CARDTABLE_WS_URL=ws://localhost:8081/ws \
CARDTABLE_GAME_ID=00000000000000000000000000000000000000000000000000000000000000aa \
  pnpm --filter @cardtable/integration-tests exec vitest run \
    __tests__/live-full-round.test.ts
```

You can also pull the published Docker image instead of building:

```bash
docker run -p 8080:8080 -p 8081:8081 \
  ghcr.io/prof-faustus/cardtable-relay:latest \
  --addr :8080 --ws-addr :8081 \
  --game 00000000000000000000000000000000000000000000000000000000000000aa \
  --start-height 100
```

## 3. Full chain stack (BSV node + SPV + relay)

The `chain` docker-compose profile spins up everything:

```bash
docker compose --profile chain up --build
# bsv-node       :18332 RPC (regtest)
# spv            :8082  HTTP   (cache + merkle-proof passthrough)
# relay          :8080  TCP  +  :8081 WS
```

Tear down:

```bash
docker compose --profile chain down -v
```

### Wiring the relay to the SPV service

Once the chain stack is up, point the relay at the SPV service so
`CurrentHeight` tracks the real BSV chain tip rather than the static
`--start-height`:

```bash
./bin/relay \
  --addr :8080 --ws-addr :8081 \
  --game <64-hex> \
  --spv-url http://localhost:8082 \
  --spv-poll-interval 2s
```

The `--start-height` flag is still used as the **initial** value before the
first poll lands and as the fallback when `--spv-url` is unreachable.

### Substituting a different BSV node

The compose file uses `bitcoinsv/bitcoin-sv:1.1.0` by default. If your
local setup runs a different node (e.g. **Teranode**, the BSV Association's
high-throughput Go-native node), the SPV service's JSON-RPC client speaks
the Bitcoin Core JSON-RPC subset — `getblockcount`, `getblockhash`,
`getblockheader`, `getmerkleproof`. Point `--rpc-url` / `--rpc-user` /
`--rpc-pass` at whatever exposes that surface.

For Teranode in particular, a legacy JSON-RPC compatibility port may
need to be enabled in its configuration; the rest of cardtable's SPV path
is unchanged.

## CI verification

The complete matrix (24 jobs per main push, 5 jobs per `v*` tag) runs in
GitHub Actions:

```
typecheck + build + test    × {Ubuntu, macOS, Windows} × {Node 20, 22}
go vet + test               × {Ubuntu, macOS, Windows} × {Go 1.22, 1.23}
live relay (native binary)  × {Ubuntu, macOS, Windows}
live full-round             × {Ubuntu, macOS, Windows}
docker image (amd64+arm64) + container smoke
browser smoke (Chromium)
spec docs + test vectors JSON
chain-integration (continue-on-error)
publish relay image to GHCR (main only)
```

Any commit on `main` that turns these red ships nowhere; tagged releases
go to <https://github.com/prof-faustus/cardtable/releases>.
