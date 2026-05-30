# Spec: Wire Protocol

> **Status:** authoritative. Aligns with CLAUDE.md §Wire Protocol and
> Formal Architecture §10 (Networking). Binary frame format; no JSON
> on the wire.

## 1. Frame format

```
┌──────────┬─────────┬──────────┬────────────┬──────────┬─────────┐
│ Magic(4) │ Ver(2)  │ Type(2)  │ Length(4)  │ Chksum(4)│ Payload │
└──────────┴─────────┴──────────┴────────────┴──────────┴─────────┘
```

| Field | Width | Encoding | Notes |
|---|---|---|---|
| Magic | 4 bytes | fixed `0x43 0x41 0x52 0x44` ("CARD") | network identifier |
| Version | 2 bytes | u16 little-endian | protocol version: high byte = major, low byte = minor |
| Type | 2 bytes | u16 little-endian | message type enum (see §3) |
| Length | 4 bytes | u32 little-endian | payload length in bytes |
| Checksum | 4 bytes | first 4 bytes of SHA-256(payload) | NOT double-SHA-256 (cheaper, sufficient for transport integrity) |
| Payload | variable | canonical serialisation per `spec/serialisation.md` | type-specific |

Maximum payload length is 32 MiB. Frames exceeding this MUST be rejected
and the peer disconnected with a `REJECT` of code
`MESSAGE_TOO_LARGE`.

## 2. Versioning

The current version is `1.0`. On `VERSION` handshake, a peer advertises
its supported version range. Mismatch is handled per §4.

## 3. Message types

### 3.1 Discovery (Bitcoin-style)

| Type | Code | Direction | Purpose |
|---|---|---|---|
| `VERSION` | `0x0001` | both | handshake initiation |
| `VERACK` | `0x0002` | both | handshake acknowledgement |
| `PING` | `0x0003` | both | liveness check |
| `PONG` | `0x0004` | both | liveness response |
| `GETADDR` | `0x0005` | both | request peer addresses |
| `ADDR` | `0x0006` | both | advertise peer addresses |

### 3.2 Object relay (Bitmessage-style)

| Type | Code | Direction | Purpose |
|---|---|---|---|
| `INV` | `0x0100` | both | advertise known object hashes |
| `GETDATA` | `0x0101` | both | request objects by hash |
| `OBJECT` | `0x0102` | both | deliver requested object |
| `NOTFOUND` | `0x0103` | both | requested object not held |
| `REJECT` | `0x0104` | both | object rejected with reason |

### 3.3 Game objects

| Type | Code | Direction | Purpose |
|---|---|---|---|
| `TABLE_ANNOUNCE` | `0x0200` | host -> network | table advertisement |
| `SEAT_COMMIT` | `0x0201` | player -> host | seat reservation |
| `TABLE_START` | `0x0202` | host -> table peers | table locked, play begins |
| `ACTION_COMMIT` | `0x0203` | player -> table peers | committed action hash (for ordering) |
| `ACTION_REVEAL` | `0x0204` | player -> table peers | revealed action + salt |
| `ROUND_RESULT` | `0x0205` | host -> table peers | round outcome |
| `TRANSCRIPT_HASH` | `0x0206` | any -> any | transcript checkpoint for sync |
| `TABLE_CLOSE` | `0x0207` | host -> table peers | table terminated |
| `TIMEOUT_NOTICE` | `0x0208` | any -> table peers | timeout activation alert |

### 3.4 Client ↔ relay (WebSocket)

The browser ↔ Go relay channel is the same binary protocol over a
WebSocket transport. Type codes `0x0300..0x03FF` are reserved for
client-relay specifics:

| Type | Code | Direction | Purpose |
|---|---|---|---|
| `JOIN_TABLE` | `0x0300` | client -> relay | request to join a table |
| `READY` | `0x0301` | client -> relay | client ready to begin |
| `ACTION` | `0x0302` | client -> relay | signed action |
| `COMMITMENT` | `0x0303` | client -> relay | entropy commitment |
| `REVEAL` | `0x0304` | client -> relay | entropy reveal |
| `CARD_REVEAL` | `0x0305` | client -> relay | card reveal proof |
| `FOLD` | `0x0306` | client -> relay | fold surrender (extended only) |
| `TRANSCRIPT_REQUEST` | `0x0307` | client -> relay | request transcript catch-up |
| `TABLE_STATE` | `0x0380` | relay -> client | current round state |
| `ACTION_ACCEPTED` | `0x0381` | relay -> client | action accepted into ordering |
| `PEER_ACTION` | `0x0382` | relay -> client | action relayed from another player |
| `TRANSCRIPT_RESPONSE` | `0x0383` | relay -> client | transcript entries |
| `ERROR` | `0x03FE` | relay -> client | error |

## 4. Handshake

```
Peer A                                        Peer B
  | -- VERSION { version, capabilities, ... }->|
  |<-- VERSION { version, capabilities, ... } --|
  | -- VERACK ------------------------------->|
  |<-- VERACK -------------------------------- |
  | (handshake complete; objects may flow)    |
```

`VERSION` carries:
- `version` (`u32`: high16 major, low16 minor)
- `services` (`u64` bitfield: see §6)
- `timestamp` (`i64` Unix seconds)
- `nonce` (`u64` random; if a peer receives its own nonce echoed, it is
  talking to itself and disconnects)
- `user_agent` (`utf8_string`)
- `start_height` (`i32` claimed best-chain height; informational only)
- `relay` (`bool` — does this peer want unsolicited INVs?)

Either side may reject during handshake by sending `REJECT` with code
`UNSUPPORTED_VERSION` and disconnecting.

## 5. Object delivery cycle

```
Peer A                                  Peer B
  | -- INV [hash_1, hash_2, ...] ----->|
  |<-- GETDATA [hash_1] ---------------|     // wants hash_1, already has hash_2
  | -- OBJECT { hash_1, payload } ---->|
```

Receiving an OBJECT, a peer:

1. Verifies the payload hashes to the advertised hash (domain-separated
   per `spec/serialisation.md` §5).
2. Forwards it to its own peers via INV, **except** the peer it came
   from, with stream-scoped propagation (§7).
3. Hands the payload to the game-state engine.

## 6. Service capability bits

| Bit | Name | Meaning |
|---|---|---|
| `0` | `NODE_TABLES` | Hosts tables; appears in lobby gossip |
| `1` | `NODE_RELAY` | Operates as a relay for non-hosting players |
| `2` | `NODE_INDEXER` | Indexes transcripts; offers transcript-catch-up |
| `3` | `NODE_SPV_PROVIDER` | Offers BSV merkle-proof retrieval |
| `4..63` | reserved | must be zero in v1 |

## 7. Streams

Three streams scope object propagation:

- `LOBBY` — global table advertisements (`TABLE_ANNOUNCE`).
- `GAME_TYPE:<type>` — game-type specific discovery (e.g.
  `GAME_TYPE:in_between`).
- `TABLE:<table_id>` — table-specific action relay (`ACTION_COMMIT`,
  `ACTION_REVEAL`, `ROUND_RESULT`, `TIMEOUT_NOTICE`).

A peer joins a stream by sending an `INV` carrying objects from that
stream; peers that do not subscribe to the stream silently drop those
INVs.

## 8. REJECT codes

| Code | Name | Meaning |
|---|---|---|
| `0x01` | `MALFORMED` | could not parse |
| `0x02` | `INVALID_CHECKSUM` | frame checksum did not match payload |
| `0x03` | `UNSUPPORTED_VERSION` | version range incompatible |
| `0x04` | `MESSAGE_TOO_LARGE` | payload above limit |
| `0x05` | `UNKNOWN_TYPE` | type code not recognised |
| `0x06` | `STALE_OBJECT` | object references an obsolete state |
| `0x07` | `DUPLICATE_OBJECT` | already seen |
| `0x08` | `INVALID_OBJECT_HASH` | payload does not hash to advertised hash |
| `0x09` | `RATE_LIMITED` | sender exceeded message rate budget |
| `0x0A` | `BAD_BINDING` | binding fields fail conformance |

A peer that sends a frame triggering a REJECT may be **scored down**
(`spec/peer-discovery.md`). Sustained bad behaviour leads to
disconnection.

## 9. Conformance

A wire-protocol implementation conforms to this spec iff:

1. It produces frames byte-identical to the canonical form for every
   test vector.
2. It rejects every `invalid_frame` test vector with the listed
   REJECT code.
3. The handshake completes against any other conforming implementation
   in `≤ 2` round trips.
4. It performs INV / GETDATA / OBJECT with no protocol-level state
   leakage between streams.
