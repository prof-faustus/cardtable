# Spec: Peer Discovery

> **Status:** authoritative. Aligns with CLAUDE.md §Peer Discovery
> Architecture and Formal Architecture §10.

## 1. Two-tier model

**Tier A — Discovery network (Bitcoin-style).** Peers exchange addresses
and capability bitfields over the discovery messages of
`spec/wire-protocol.md` §3.1. A peer's primary role at this tier is
finding other peers and the tables they host.

**Tier B — Game object network (Bitmessage-style).** Peers exchange
application-layer objects (`TABLE_ANNOUNCE`, `ACTION_COMMIT`,
`OBJECT`-carried game data) over the relay messages of §3.2. Tier B is
stream-scoped (`LOBBY`, `GAME_TYPE:<type>`, `TABLE:<id>`).

## 2. Bootstrap

A new peer bootstraps in order:

1. **Hardcoded seed nodes.** A short, signed list of well-known seed
   peers (3–7 nodes for v1). Updated only via signed software release.
2. **DNS seeds.** A small set of DNS A/AAAA records returning fresh
   peer addresses. Controlled by the project; rotated regularly.
3. **Cached peer database.** From previous sessions; persisted in
   `peers/cached.json` (or platform-equivalent secure storage).
4. **Manual peer entry.** Operator / developer flag for local testing
   and bring-up.

Of these, **at least one** must succeed before the peer attempts any
table operation. If all fail, the client surfaces a
`NO_PEERS_AVAILABLE` error and offers manual entry as a recovery
option.

## 3. Peer store buckets

The peer store classifies known peers into mutually-exclusive buckets:

| Bucket | Promotion criterion | Demotion criterion |
|---|---|---|
| `tried` | one successful handshake within the last 24 hours | three consecutive failed connects |
| `new` | observed in an `ADDR` message but not yet contacted | aged out (24 hours) |
| `suspicious` | one or more REJECTs against this peer | none until ban window passes |
| `table-host` | advertises `NODE_TABLES` and has hosted ≥1 completed table | aged out (72 hours) or `suspicious` |
| `lightweight` | does not advertise `NODE_TABLES` | as above |

The store enforces address diversity: at most `k = 8` peers per `/16`
IPv4 prefix and per `/32` IPv6 prefix.

## 4. Peer scoring

Each peer carries a score `s ∈ [−128, +128]` (i8). Adjustments:

| Event | Score delta |
|---|---|
| Successful handshake | `+2` |
| `PONG` within RTT budget | `+1` |
| `INV` of a fresh, valid object | `+1` |
| `INV` of a `STALE_OBJECT` | `−2` |
| `INV` of an `INVALID_OBJECT_HASH` | `−16` |
| Frame parse failure | `−8` |
| Frame checksum failure | `−16` |
| Handshake timeout | `−4` |
| Rate-limit exceeded | `−4` |
| Sent `REJECT` of code `MALFORMED` against us | `−1` (we ignore; their problem) |
| Completed table without abandonment | `+10` |
| Abandoned table within session | `−10` |

When `s ≤ −64`, the peer is **banned** for 24 hours; after the ban
window the score resets to `0` and the peer re-enters `new`.

## 5. Gossip-for-discovery, direct-channel-for-play

The discovery network is gossip-based; the play channel is direct or
near-direct. The split is enforced by message routing:

- `TABLE_ANNOUNCE`, `ADDR`, `GETADDR`, `INV/GETDATA/OBJECT` for
  discovery objects → relayed on the lobby stream.
- `ACTION_COMMIT`, `ACTION_REVEAL`, `TIMEOUT_NOTICE`, `ROUND_RESULT`
  for in-session play → relayed only on the `TABLE:<id>` stream, to
  table-resident peers. Non-table peers do not see in-session traffic.

This split is normative: a peer that propagates `ACTION_COMMIT` on the
lobby stream is misbehaving and accumulates score penalty
`STALE_OBJECT (-2)` per occurrence.

## 6. Liveness

`PING / PONG` is exchanged every `60 ± 10` seconds during an active
table session, every `120 ± 30` seconds otherwise. A peer that misses
two consecutive `PONG`s within the RTT budget (`5s` mainnet, `100ms`
loopback) is marked `disconnected` and removed from active streams;
the score adjustment is `−4`.

## 7. Conformance

A peer-discovery implementation conforms to this spec iff:

1. It implements all six bootstrap mechanisms of §2 with fallback in
   the order listed.
2. Its peer-store admit/promote/demote behaviour matches §3 exactly.
3. Its score deltas match §4 within ±0 tolerance for every named event.
4. It enforces the gossip/direct split of §5 (table-stream traffic
   never appears on the lobby stream).
