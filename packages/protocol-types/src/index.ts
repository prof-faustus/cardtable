/**
 * Public API of @cardtable/protocol-types.
 *
 * Per PROJECT_SPEC.md §Coding Standards: named exports only, no default
 * exports, barrels only at the package root.
 */

// Primitives + branded IDs + Result/Error
export type {
  GameId,
  PlayerId,
  Seat,
  RoundNumber,
  Hash256,
  Pubkey33,
  TxId,
  Outpoint,
  Satoshis,
  BlockHeight,
  ActionNonce,
  RuleSetHash,
  Result,
  ErrorCode,
  ProtocolError,
} from './primitives.js';
export {
  asGameId,
  asPlayerId,
  asSeat,
  asRoundNumber,
  asHash256,
  asPubkey33,
  asTxId,
  asSatoshis,
  asBlockHeight,
  asActionNonce,
  asRuleSetHash,
  ok,
  err,
  protocolError,
} from './primitives.js';

// RuleSet
export type {
  GameType,
  PenaltySchedule,
  SettlementRules,
  RecoveryRules,
  RuleSet,
} from './rule-set.js';
export { encodeRuleSet, decodeRuleSet, ruleSetHash } from './rule-set-codec.js';

// Player
export type {
  ParticipationStatus,
  WalletIdentity,
  PlayerState,
} from './player.js';

// Cards
export type {
  Suit,
  Rank,
  RevealedCard,
  CardCommitment,
  CardLifecycleState,
  ConcealedCard,
  RevealProof,
  DeckCommitment,
} from './cards.js';
export {
  SUITS_IN_ORDER,
  RANKS_IN_ORDER,
  cardOrdinal,
  cardFromOrdinal,
} from './cards.js';

// Actions
export type {
  ActionType,
  SignedAction,
  SignedActionBase,
  JoinAction,
  EntropyCommitAction,
  EntropyRevealAction,
  CardRevealAction,
  BetAction,
  PassAction,
  FoldAction,
  SettleAction,
  RotateTurnAction,
  TableLockAction,
  TableCloseAction,
  TimeoutAction,
  RecoveryAction,
} from './actions.js';

// Game state
export type {
  StateClass,
  LifecycleStatus,
  RoundState,
  GameInstance,
} from './game-state.js';

// Settlement & recovery
export type {
  SettlementOutcome,
  SettlementResult,
  RecoveryRecord,
} from './settlement.js';

// Transcript
export type { TranscriptEntry, AuditTranscript } from './transcript.js';

// Messages
export {
  MESSAGE_TYPE,
} from './messages.js';
export type {
  MessageType,
  ClientMessage,
  RelayMessage,
} from './messages.js';

// Serialisation primitives + hashing
export {
  CanonicalWriter,
  CanonicalReader,
  MAX_RESERVED_TRAILING,
} from './serialisation.js';
export {
  TYPE_TAG,
  domainSha256,
  domainSha256Sync,
  bytesToHex,
  hexToBytes,
} from './hash.js';
export type { TypeTag } from './hash.js';

export { encodeRoundState, computeStateHash, chainsFromHash } from './serialise.js';
