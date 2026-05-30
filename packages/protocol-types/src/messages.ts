/**
 * Wire-protocol message types — client ↔ relay specifically.
 *
 * Per `spec/wire-protocol.md` §3.4. The binary wire encoding lives in
 * `./serialisation.ts`; this file defines the application-level shapes.
 */

import type { Hash256 } from './primitives.js';
import type { SignedAction } from './actions.js';
import type { RoundState } from './game-state.js';
import type { SettlementResult, RecoveryRecord } from './settlement.js';
import type { TranscriptEntry } from './transcript.js';

/** Numeric type codes per `spec/wire-protocol.md` §3. */
export const MESSAGE_TYPE = {
  // Discovery (0x0001..0x00FF)
  VERSION: 0x0001,
  VERACK: 0x0002,
  PING: 0x0003,
  PONG: 0x0004,
  GETADDR: 0x0005,
  ADDR: 0x0006,
  // Object relay (0x0100..0x01FF)
  INV: 0x0100,
  GETDATA: 0x0101,
  OBJECT: 0x0102,
  NOTFOUND: 0x0103,
  REJECT: 0x0104,
  // Game objects (0x0200..0x02FF)
  TABLE_ANNOUNCE: 0x0200,
  SEAT_COMMIT: 0x0201,
  TABLE_START: 0x0202,
  ACTION_COMMIT: 0x0203,
  ACTION_REVEAL: 0x0204,
  ROUND_RESULT: 0x0205,
  TRANSCRIPT_HASH: 0x0206,
  TABLE_CLOSE: 0x0207,
  TIMEOUT_NOTICE: 0x0208,
  // Client ↔ relay (0x0300..0x03FF)
  C2R_JOIN_TABLE: 0x0300,
  C2R_READY: 0x0301,
  C2R_ACTION: 0x0302,
  C2R_COMMITMENT: 0x0303,
  C2R_REVEAL: 0x0304,
  C2R_CARD_REVEAL: 0x0305,
  C2R_FOLD: 0x0306,
  C2R_TRANSCRIPT_REQUEST: 0x0307,
  R2C_TABLE_STATE: 0x0380,
  R2C_ACTION_ACCEPTED: 0x0381,
  R2C_PEER_ACTION: 0x0382,
  R2C_TRANSCRIPT_RESPONSE: 0x0383,
  R2C_ERROR: 0x03FE,
} as const satisfies Readonly<Record<string, number>>;

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE];

/** Client → relay messages. */
export type ClientMessage =
  | { readonly type: 'JOIN_TABLE'; readonly game_id: Hash256 }
  | { readonly type: 'READY'; readonly game_id: Hash256 }
  | { readonly type: 'ACTION'; readonly game_id: Hash256; readonly action: SignedAction }
  | { readonly type: 'TRANSCRIPT_REQUEST'; readonly game_id: Hash256; readonly from_state: Hash256 }
  | { readonly type: 'PING' };

/** Relay → client messages. */
export type RelayMessage =
  | { readonly type: 'TABLE_STATE'; readonly state: RoundState }
  | { readonly type: 'ACTION_ACCEPTED'; readonly action: SignedAction }
  | { readonly type: 'TIMEOUT_NOTICE'; readonly state_hash: Hash256 }
  | { readonly type: 'SETTLEMENT'; readonly result: SettlementResult }
  | { readonly type: 'RECOVERY_ACTIVATED'; readonly record: RecoveryRecord }
  | { readonly type: 'PEER_ACTION'; readonly action: SignedAction }
  | { readonly type: 'TRANSCRIPT_RESPONSE'; readonly entries: readonly TranscriptEntry[] }
  | { readonly type: 'ERROR'; readonly code: string; readonly message: string }
  | { readonly type: 'PONG' };
