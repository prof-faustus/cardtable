/**
 * Primitive types and branded identifiers.
 *
 * Per `spec/serialisation.md` §2 every wire and storage primitive has a
 * specific encoding. The TypeScript primitive surface here is the
 * application-level representation; encoding is handled by
 * {@link "./serialisation.ts"}.
 *
 * Branded types prevent unsafe identifier confusion at the type level.
 * Constructors live alongside each brand.
 */

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;

/** Game session identifier — the SHA-256 of the TableOpen outpoint. */
export type GameId = string & { readonly [__brand]: 'GameId' };

/** Stable player identifier derived from the wallet-identity pubkey. */
export type PlayerId = string & { readonly [__brand]: 'PlayerId' };

/** Player seat index within a session (0-based, ascending). */
export type Seat = number & { readonly [__brand]: 'Seat' };

/** A round number within a session (0-based, incremented at RotateTurn). */
export type RoundNumber = number & { readonly [__brand]: 'RoundNumber' };

/** Hex-encoded 32-byte SHA-256 hash. */
export type Hash256 = string & { readonly [__brand]: 'Hash256' };

/** Hex-encoded 33-byte secp256k1 compressed public key. */
export type Pubkey33 = string & { readonly [__brand]: 'Pubkey33' };

/** Hex-encoded BSV transaction id. */
export type TxId = string & { readonly [__brand]: 'TxId' };

/** BSV outpoint encoded as `<txid>:<vout>`. */
export type Outpoint = string & { readonly [__brand]: 'Outpoint' };

/** Satoshi value (non-negative integer). */
export type Satoshis = number & { readonly [__brand]: 'Satoshis' };

/** Block height (non-negative integer, < 5e8 for nLockTime height-interpretation). */
export type BlockHeight = number & { readonly [__brand]: 'BlockHeight' };

/** Action nonce — opaque 32-byte identifier per (player, state) preventing replay. */
export type ActionNonce = string & { readonly [__brand]: 'ActionNonce' };

/** Rule-set hash — SHA-256 of canonical-encoded RuleSet. */
export type RuleSetHash = string & { readonly [__brand]: 'RuleSetHash' };

// ---------------------------------------------------------------------------
// Constructors (single point of validation per branded type)
// ---------------------------------------------------------------------------

/**
 * Construct a {@link Hash256} from a 64-character lowercase hex string.
 * @throws if the input is not exactly 64 lowercase hex characters.
 */
export function asHash256(hex: string): Hash256 {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asHash256: expected 64 lowercase hex chars, got ${hex.length}`);
  }
  return hex as Hash256;
}

/**
 * Construct a {@link Pubkey33} from a 66-character lowercase hex string
 * representing a 33-byte compressed secp256k1 public key.
 * @throws if the input does not have the required shape.
 */
export function asPubkey33(hex: string): Pubkey33 {
  if (!/^0[23][0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asPubkey33: expected 33-byte compressed pubkey (66 hex chars starting 02/03), got ${hex}`);
  }
  return hex as Pubkey33;
}

/**
 * Construct a {@link GameId} (a 64-char hex hash).
 * @throws if the input does not have 64 lowercase hex chars.
 */
export function asGameId(hex: string): GameId {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asGameId: expected 64 lowercase hex chars`);
  }
  return hex as GameId;
}

/**
 * Construct a {@link RuleSetHash}.
 * @throws if the input does not have 64 lowercase hex chars.
 */
export function asRuleSetHash(hex: string): RuleSetHash {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asRuleSetHash: expected 64 lowercase hex chars`);
  }
  return hex as RuleSetHash;
}

/**
 * Construct a {@link Seat} from a non-negative integer.
 * @throws if the input is not a non-negative safe integer.
 */
export function asSeat(n: number): Seat {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`asSeat: expected non-negative safe integer, got ${n}`);
  }
  return n as Seat;
}

/**
 * Construct a {@link RoundNumber} from a non-negative integer.
 * @throws if invalid.
 */
export function asRoundNumber(n: number): RoundNumber {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`asRoundNumber: expected non-negative safe integer, got ${n}`);
  }
  return n as RoundNumber;
}

/**
 * Construct a {@link Satoshis} value from a non-negative integer.
 * @throws if the input is fractional or negative.
 */
export function asSatoshis(n: number): Satoshis {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`asSatoshis: expected non-negative safe integer, got ${n}`);
  }
  return n as Satoshis;
}

/**
 * Construct a {@link BlockHeight} from a non-negative integer below the
 * nLockTime height/timestamp interpretation threshold (5e8 — values at or
 * above this are interpreted as Unix timestamps, not block heights, by
 * the BSV consensus rules inherited from the original protocol).
 * @throws if outside [0, 500_000_000).
 */
export function asBlockHeight(n: number): BlockHeight {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 500_000_000) {
    throw new Error(`asBlockHeight: expected integer in [0, 5e8), got ${n}`);
  }
  return n as BlockHeight;
}

/**
 * Construct an {@link ActionNonce} (64 hex chars).
 */
export function asActionNonce(hex: string): ActionNonce {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asActionNonce: expected 64 lowercase hex chars`);
  }
  return hex as ActionNonce;
}

/**
 * Construct a {@link TxId} (64 hex chars).
 */
export function asTxId(hex: string): TxId {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asTxId: expected 64 lowercase hex chars`);
  }
  return hex as TxId;
}

/**
 * Construct a {@link PlayerId} (64 hex chars derived from the wallet-identity pubkey).
 */
export function asPlayerId(hex: string): PlayerId {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`asPlayerId: expected 64 lowercase hex chars`);
  }
  return hex as PlayerId;
}

// ---------------------------------------------------------------------------
// Result type — preferred over thrown exceptions for fallible operations
// ---------------------------------------------------------------------------

/**
 * A {@link Result} represents either a successful value of type `T` or
 * an error of type `E`. Per PROJECT_SPEC.md §Coding Standards (TypeScript), all
 * fallible protocol operations return `Result` rather than throwing.
 */
export type Result<T, E = ProtocolError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Construct a successful {@link Result}. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Construct a failed {@link Result}. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * The complete enumeration of protocol-level error codes. Implementations
 * MUST emit one of these codes (not free-text) for every protocol-level
 * rejection; the codes are part of the conformance surface (test vectors
 * cite them by name).
 */
export type ErrorCode =
  | 'INVALID_STAKE_AMOUNT'
  | 'INVALID_REVEAL_PROOF'
  | 'INVALID_TX_CONFORMANCE'
  | 'INVALID_SIGNATURE'
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_ACTION_FOR_STATE'
  | 'INVALID_BET_AMOUNT'
  | 'INVALID_SUCCESSOR_TEMPLATE'
  | 'INVALID_RULE_SET'
  | 'STALE_STATE'
  | 'STATE_NOT_FOUND'
  | 'DOUBLE_SPEND_CONFLICT'
  | 'TIMEOUT_NOT_MATURE'
  | 'RECOVERY_NOT_MATURE'
  | 'BAD_BINDING'
  | 'PLAYER_NOT_SEATED'
  | 'PLAYER_ALREADY_SEATED'
  | 'TABLE_FULL'
  | 'TABLE_NOT_LOCKABLE'
  | 'SEAT_OUT_OF_RANGE'
  | 'SERIALISATION_ERROR'
  | 'UNSUPPORTED_VERSION';

/**
 * A {@link ProtocolError} carries a typed code and an optional
 * human-readable context. Match on `code` for control flow; treat
 * `context` as advisory.
 */
export interface ProtocolError {
  readonly code: ErrorCode;
  readonly context?: string;
}

/** Build a {@link ProtocolError}. */
export function protocolError(code: ErrorCode, context?: string): ProtocolError {
  return context === undefined ? { code } : { code, context };
}
