# Runbook: live regtest chain end-to-end

This brings up a **real** BSV node (regtest) plus the cardtable SPV
service and proves the SPV layer tracks the live chain. It is the
on-chain counterpart to the deterministic mock-chain tests in
`apps/relay-go/internal/chain` and `apps/relay-go/tests/adversarial`.

> The BSV node is a heavyweight daemon. Run it in a VM/CI, not on a
> bare workstation you want to keep clean. CI runs this automatically in
> the `chain-integration` job.

## Bring up the stack

```bash
docker compose -p cardtable --profile chain up -d --build bsv-node spv
```

This starts:
- `cardtable-bsv-node` — `bitcoinsv/bitcoin-sv:1.1.0` in `-regtest=1`,
  RPC on `:18332` (user `cardtable`, password `cardtable-dev-rpc-password`).
- `cardtable-spv` — the cardtable SPV service polling the node's RPC
  every 2s and serving `GET /headers/latest -> {"tip": N}` on `:8082`.

## Wait for the node, then mine and watch the SPV follow

```bash
RPC="docker exec cardtable-bsv-node bitcoin-cli -regtest \
  -rpcuser=cardtable -rpcpassword=cardtable-dev-rpc-password"

# wait for RPC
until $RPC getblockcount >/dev/null 2>&1; do sleep 2; done

# (the SPV poll loop retries; a restart binds it to the ready node now)
docker restart cardtable-spv && sleep 5

curl -s localhost:8082/headers/latest          # baseline tip

ADDR=$($RPC getnewaddress)
$RPC generatetoaddress 6 "$ADDR" >/dev/null     # mine 6 real blocks
sleep 5
curl -s localhost:8082/headers/latest          # tip advanced by 6
```

The SPV `tip` converges on the node's `getblockcount` within a couple of
poll intervals — the proof that the cardtable chain layer reflects the
live BSV chain.

## Wire a relay to the live chain (optional)

```bash
docker run -d --name cardtable-relay-live --network cardtable_default \
  cardtable-relay:dev \
  --addr :8080 --ws-addr :8081 \
  --game 00000000000000000000000000000000000000000000000000000000000000aa \
  --spv-url http://cardtable-spv:8082 --spv-poll-interval 2s
docker logs cardtable-relay-live   # "spv height source configured ..."
```

## Tear down

```bash
docker rm -f cardtable-relay-live 2>/dev/null || true
docker compose -p cardtable --profile chain down -v
```

## Notes / gotchas (fixed in the compose file)

- The `bsv-node` command must lead with `bitcoind` — the image
  entrypoint only initialises the regtest datadir when `argv[0]` is
  `bitcoind`/`bitcoin-cli`, otherwise it `exec`s the bare flag.
- `bitcoinsv 1.1.0` refuses to start without `-minminingtxfee`.
- On WSL2 without systemd the distro idle-shuts-down ~8s after the last
  interactive process exits, taking the node with it (clean SIGTERM).
  Keep a session alive (or run the whole flow in one script) while the
  node is up. CI Linux runners do not have this issue.
