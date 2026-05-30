/**
 * Constants and message-type enum for the cardtable wire protocol
 * per `spec/wire-protocol.md`. Mirrors apps/relay-go/pkg/wire/types.go.
 */

/** Fixed 4-byte network identifier: ASCII "CARD". */
export const Magic = new Uint8Array([0x43, 0x41, 0x52, 0x44]);

/** Protocol version 1.0: high byte = major, low byte = minor. */
export const VERSION_1_0 = 0x0100;

/** Fixed 16-byte header size (magic + version + type + length + checksum). */
export const HEADER_SIZE = 16;

/** 32 MiB hard cap on payload size per spec §1. */
export const MAX_PAYLOAD_SIZE = 32 * 1024 * 1024;

/** Message type discriminants per spec §3. */
export enum MsgType {
  // Discovery (§3.1)
  Version = 0x0001,
  Verack = 0x0002,
  Ping = 0x0003,
  Pong = 0x0004,
  Getaddr = 0x0005,
  Addr = 0x0006,

  // Object relay (§3.2)
  Inv = 0x0100,
  Getdata = 0x0101,
  Object = 0x0102,
  NotFound = 0x0103,
  Reject = 0x0104,

  // Game objects (§3.3)
  TableAnnounce = 0x0200,
  SeatCommit = 0x0201,
  TableStart = 0x0202,
  ActionCommit = 0x0203,
  ActionReveal = 0x0204,
  RoundResult = 0x0205,
  TranscriptHash = 0x0206,
  TableClose = 0x0207,
  TimeoutNotice = 0x0208,

  // Client ↔ relay (§3.4)
  JoinTable = 0x0300,
  Ready = 0x0301,
  Action = 0x0302,
  Commitment = 0x0303,
  Reveal = 0x0304,
  CardReveal = 0x0305,
  Fold = 0x0306,
  TranscriptRequest = 0x0307,
  TableState = 0x0380,
  ActionAccepted = 0x0381,
  PeerAction = 0x0382,
  TranscriptResponse = 0x0383,
  ErrorReply = 0x03fe,
}

/** REJECT reason codes per spec §8. */
export enum RejectCode {
  Malformed = 0x01,
  InvalidChecksum = 0x02,
  UnsupportedVersion = 0x03,
  MessageTooLarge = 0x04,
  UnknownType = 0x05,
  StaleObject = 0x06,
  DuplicateObject = 0x07,
  InvalidObjectHash = 0x08,
  RateLimited = 0x09,
  BadBinding = 0x0a,
}
