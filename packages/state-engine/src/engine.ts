/**
 * Core state-engine API.
 *
 * The engine is a **pure function** over (state, action, ruleSet). There
 * is no clock, no I/O, no shared state. All time is passed in explicitly
 * as a `current_block_height` field on the action where relevant.
 */

import type {
  ActionNonce,
  ActionType,
  BetAction,
  BlockHeight,
  CardRevealAction,
  ConcealedCard,
  EntropyCommitAction,
  EntropyRevealAction,
  FoldAction,
  GameId,
  Hash256,
  JoinAction,
  PassAction,
  ProtocolError,
  RecoveryAction,
  Result,
  RotateTurnAction,
  RoundState,
  RuleSet,
  RuleSetHash,
  Satoshis,
  Seat,
  SettleAction,
  SettlementOutcome,
  SettlementResult,
  SignedAction,
  StateClass,
  TableCloseAction,
  TableLockAction,
  TimeoutAction,
} from '@cardtable/protocol-types';
import {
  asActionNonce,
  asBlockHeight,
  asGameId,
  asHash256,
  asRoundNumber,
  asRuleSetHash,
  asSatoshis,
  asSeat,
  err,
  ok,
  protocolError,
} from '@cardtable/protocol-types';
import { addToPot, subtractFromPot } from './pot.js';
import { classifyInBetweenRound, clampSat, computeValueTransfer } from './penalties.js';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const ZERO_HASH: Hash256 = asHash256('0'.repeat(64));

/**
 * The fresh initial state of a session. `state_class = S1_SEAT_OPEN`,
 * no players seated, no pot, no acting player.
 */
export function initialState(
  game_id: GameId,
  rule_set_hash: RuleSetHash,
  recovery_deadline: BlockHeight,
): RoundState {
  return {
    state_class: 'S1_SEAT_OPEN',
    game_id,
    rule_set_hash,
    round_number: asRoundNumber(0),
    acting_player_seat: null,
    players: [],
    pot_value: asSatoshis(0),
    visible_cards: [],
    hidden_commitment_refs: [],
    allowed_actions: ['Join', 'TableLock'],
    decision_deadline_block_height: null,
    recovery_deadline_block_height: recovery_deadline,
    successor_template_hashes: [],
    combined_entropy: null,
    deck_commitment_hash: null,
    concealed_deck: null,
    prior_state_hash: null,
    state_hash: ZERO_HASH, // computed by callers; not used internally
  };
}

// ---------------------------------------------------------------------------
// Legal actions per state class
// ---------------------------------------------------------------------------

/**
 * Pure function from `state_class` to the set of legal action types at
 * that state. Used both internally and as a public API for clients to
 * compute UI affordances.
 */
export function getLegalActions(state_class: StateClass): readonly ActionType[] {
  switch (state_class) {
    case 'S0_TABLE_OPEN': return [];
    case 'S1_SEAT_OPEN': return ['Join', 'TableLock'];
    case 'S2_TABLE_LOCKED': return ['EntropyCommit'];
    case 'S3_ENTROPY_COMMIT_WINDOW': return ['EntropyCommit'];
    case 'S4_ENTROPY_REVEAL_WINDOW': return ['EntropyReveal'];
    case 'S5_DECK_COMMITTED': return ['CardReveal'];
    case 'S6_CARD_REVEAL_FIRST': return ['CardReveal'];
    case 'S7_CARD_REVEAL_SECOND': return ['BetAction', 'Pass', 'Timeout', 'Fold'];
    case 'S8_BET_DECISION': return ['BetAction', 'Pass', 'Timeout', 'Fold'];
    case 'S9_CARD_REVEAL_THIRD': return ['CardReveal'];
    case 'S10_SETTLED_ROUND': return ['Settle'];
    case 'S11_ROTATE_TURN': return ['RotateTurn'];
    case 'S12_TABLE_CLOSE': return ['TableClose'];
    case 'RECOVERED': return [];
    default: {
      const _exhaustive: never = state_class;
      throw new Error(`getLegalActions: non-exhaustive state_class ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// applyAction — the canonical transition function
// ---------------------------------------------------------------------------

/**
 * Apply a signed action to a state, producing the successor state. Pure;
 * returns `Result` with a typed error on rejection. Time is passed via
 * `currentHeight` (the block height as of when the caller wants the
 * transition evaluated). `currentHeight` is required for any state class
 * that has a decision deadline.
 */
export function applyAction(
  state: RoundState,
  action: SignedAction,
  ruleSet: RuleSet,
  currentHeight: BlockHeight,
): Result<RoundState, ProtocolError> {
  // Binding: action must reference the current state's game and round
  // (the prior-state-hash check is the responsibility of the caller; we
  // do not have the state's canonical encoding here without re-running
  // hash machinery — that lives in the orchestrator).
  if (action.game_id !== state.game_id) {
    return err(protocolError('STALE_STATE', 'action.game_id mismatch'));
  }

  // Action class allowance for this state class. Recovery is a global
  // outcome that bypasses the per-state allow list; it is gated only
  // by the recovery deadline checked in applyRecovery. This matches
  // the Go engine's special case.
  if (action.action_type !== 'Recovery') {
    const legal = getLegalActions(state.state_class);
    if (!legal.includes(action.action_type)) {
      return err(protocolError(
        'INVALID_ACTION_FOR_STATE',
        `${action.action_type} not legal at ${state.state_class}`,
      ));
    }
  }

  switch (action.action_type) {
    case 'Join': return applyJoin(state, action, ruleSet);
    case 'TableLock': return applyTableLock(state, action, ruleSet, currentHeight);
    case 'EntropyCommit': return applyEntropyCommit(state, action, ruleSet);
    case 'EntropyReveal': return applyEntropyReveal(state, action, ruleSet);
    case 'CardReveal': return applyCardReveal(state, action, ruleSet);
    case 'BetAction': return applyBet(state, action, ruleSet);
    case 'Pass': return applyPass(state, action, ruleSet);
    case 'Fold': return applyFold(state, action, ruleSet);
    case 'Settle': return applySettle(state, action, ruleSet);
    case 'RotateTurn': return applyRotateTurn(state, action, ruleSet);
    case 'TableClose': return applyTableClose(state, action, ruleSet);
    case 'Timeout': return applyTimeout(state, action, ruleSet, currentHeight);
    case 'Recovery': return applyRecovery(state, action, ruleSet, currentHeight);
    default: {
      const _exhaustive: never = action;
      return err(protocolError(
        'INVALID_ACTION_FOR_STATE',
        `unknown action ${String(_exhaustive)}`,
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Per-action handlers
// ---------------------------------------------------------------------------

function applyJoin(
  state: RoundState,
  action: JoinAction,
  ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S1_SEAT_OPEN') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'Join outside S1'));
  }
  if (action.stake_amount !== ruleSet.stake_amount) {
    return err(protocolError(
      'INVALID_STAKE_AMOUNT',
      `expected ${ruleSet.stake_amount}, got ${action.stake_amount}`,
    ));
  }
  if (state.players.length >= ruleSet.player_count_max) {
    return err(protocolError('TABLE_FULL', `max ${ruleSet.player_count_max} seats`));
  }
  const seat = asSeat(action.acting_player_seat ?? state.players.length);
  if (state.players.some((p) => p.seat === seat)) {
    return err(protocolError('PLAYER_ALREADY_SEATED', `seat ${seat} taken`));
  }

  const next: RoundState = {
    ...state,
    players: [
      ...state.players,
      {
        seat,
        player_id: action.player_pubkey as unknown as RoundState['players'][number]['player_id'],
        value_signing_pubkey: action.player_pubkey,
        participation_status: 'joined',
        stake_at_risk: action.stake_amount,
        entropy_committed: false,
        entropy_commitment_hash: null,
        entropy_revealed: false,
        entropy_value: null,
        concealed_card_refs: [],
        default_preferences: {},
      },
    ],
    prior_state_hash: state.state_hash,
  };
  return ok(next);
}

function applyTableLock(
  state: RoundState,
  _action: TableLockAction,
  ruleSet: RuleSet,
  _currentHeight: BlockHeight,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S1_SEAT_OPEN') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'TableLock outside S1'));
  }
  if (state.players.length < ruleSet.player_count_min) {
    return err(protocolError(
      'TABLE_NOT_LOCKABLE',
      `need ${ruleSet.player_count_min} seats, have ${state.players.length}`,
    ));
  }
  const next: RoundState = {
    ...state,
    state_class: 'S3_ENTROPY_COMMIT_WINDOW',
    allowed_actions: getLegalActions('S3_ENTROPY_COMMIT_WINDOW'),
    prior_state_hash: state.state_hash,
  };
  return ok(next);
}

function applyEntropyCommit(
  state: RoundState,
  action: EntropyCommitAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S3_ENTROPY_COMMIT_WINDOW') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'EntropyCommit outside S3'));
  }
  if (action.acting_player_seat === null) {
    return err(protocolError('SEAT_OUT_OF_RANGE', 'EntropyCommit requires acting_player_seat'));
  }
  const seat = action.acting_player_seat;
  const idx = state.players.findIndex((p) => p.seat === seat);
  if (idx < 0) return err(protocolError('PLAYER_NOT_SEATED', `seat ${seat}`));

  const existing = state.players[idx];
  if (existing === undefined) {
    return err(protocolError('PLAYER_NOT_SEATED', `seat ${seat} indexing failure`));
  }
  if (existing.entropy_committed) {
    return err(protocolError('INVALID_STATE_TRANSITION', 'seat already committed'));
  }

  const players = [
    ...state.players.slice(0, idx),
    { ...existing, entropy_committed: true, entropy_commitment_hash: action.commitment_hash },
    ...state.players.slice(idx + 1),
  ];

  // Advance to reveal window only when every seat has committed.
  const allCommitted = players.every((p) => p.entropy_committed);
  const nextClass: StateClass = allCommitted ? 'S4_ENTROPY_REVEAL_WINDOW' : 'S3_ENTROPY_COMMIT_WINDOW';
  return ok({
    ...state,
    players,
    state_class: nextClass,
    allowed_actions: getLegalActions(nextClass),
    prior_state_hash: state.state_hash,
  });
}

function applyEntropyReveal(
  state: RoundState,
  action: EntropyRevealAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S4_ENTROPY_REVEAL_WINDOW') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'EntropyReveal outside S4'));
  }
  if (action.acting_player_seat === null) {
    return err(protocolError('SEAT_OUT_OF_RANGE', 'EntropyReveal requires acting_player_seat'));
  }
  const seat = action.acting_player_seat;
  const idx = state.players.findIndex((p) => p.seat === seat);
  if (idx < 0) return err(protocolError('PLAYER_NOT_SEATED', `seat ${seat}`));
  const existing = state.players[idx];
  if (existing === undefined) {
    return err(protocolError('PLAYER_NOT_SEATED', `seat ${seat} indexing failure`));
  }
  if (!existing.entropy_committed) {
    return err(protocolError('INVALID_STATE_TRANSITION', 'seat must commit before reveal'));
  }
  if (existing.entropy_revealed) {
    return err(protocolError('INVALID_STATE_TRANSITION', 'seat already revealed'));
  }

  const players = [
    ...state.players.slice(0, idx),
    {
      ...existing,
      entropy_revealed: true,
      entropy_value: action.entropy,
      participation_status: 'active' as const,
    },
    ...state.players.slice(idx + 1),
  ];
  const allRevealed = players.every((p) => p.entropy_revealed);
  const nextClass: StateClass = allRevealed ? 'S5_DECK_COMMITTED' : 'S4_ENTROPY_REVEAL_WINDOW';
  return ok({
    ...state,
    players,
    state_class: nextClass,
    allowed_actions: getLegalActions(nextClass),
    prior_state_hash: state.state_hash,
  });
}

function applyCardReveal(
  state: RoundState,
  action: CardRevealAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  // Reveal at S5 -> S6 (first card), S6 -> S7 (second card), S9 -> S10 (third card).
  let nextClass: StateClass;
  switch (state.state_class) {
    case 'S5_DECK_COMMITTED': nextClass = 'S6_CARD_REVEAL_FIRST'; break;
    case 'S6_CARD_REVEAL_FIRST': nextClass = 'S7_CARD_REVEAL_SECOND'; break;
    case 'S9_CARD_REVEAL_THIRD': nextClass = 'S10_SETTLED_ROUND'; break;
    default:
      return err(protocolError('INVALID_ACTION_FOR_STATE', `CardReveal at ${state.state_class}`));
  }

  // After the second card, the engine moves into S8 BET_DECISION (the
  // active player must act). The S7 -> S8 transition happens implicitly
  // when the second card has been revealed.
  let finalClass: StateClass = nextClass;
  let acting_player_seat = state.acting_player_seat;
  if (nextClass === 'S7_CARD_REVEAL_SECOND') {
    finalClass = 'S8_BET_DECISION';
    // The active player is the first seated player by default; the
    // orchestrator may rotate via RotateTurn.
    if (acting_player_seat === null) {
      const first = state.players[0];
      if (first !== undefined) acting_player_seat = first.seat;
    }
  }

  return ok({
    ...state,
    state_class: finalClass,
    visible_cards: [...state.visible_cards, action.reveal.revealed_card],
    acting_player_seat,
    allowed_actions: getLegalActions(finalClass),
    prior_state_hash: state.state_hash,
  });
}

function applyBet(
  state: RoundState,
  action: BetAction,
  ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S8_BET_DECISION') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'BetAction outside S8'));
  }
  if (action.bet_amount < ruleSet.min_bet || action.bet_amount > ruleSet.max_bet) {
    return err(protocolError(
      'INVALID_BET_AMOUNT',
      `bet ${action.bet_amount} not in [${ruleSet.min_bet}, ${ruleSet.max_bet}]`,
    ));
  }
  return ok({
    ...state,
    state_class: 'S9_CARD_REVEAL_THIRD',
    pot_value: addToPot(state.pot_value, action.bet_amount),
    allowed_actions: getLegalActions('S9_CARD_REVEAL_THIRD'),
    prior_state_hash: state.state_hash,
  });
}

function applyPass(
  state: RoundState,
  _action: PassAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S8_BET_DECISION') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'Pass outside S8'));
  }
  return ok({
    ...state,
    state_class: 'S11_ROTATE_TURN',
    allowed_actions: getLegalActions('S11_ROTATE_TURN'),
    prior_state_hash: state.state_hash,
  });
}

/**
 * Fold transitions every card the acting player currently holds in
 * `ASSIGNED_CONCEALED` state to `SURRENDERED` without revealing the
 * face, then marks the player as `folded`. Per
 * `spec/card-protocol.md` §7 a fold MUST NOT leak card face data;
 * the engine enforces that by leaving `concealed_deck` entries'
 * commitments and ciphertexts untouched and updating only the
 * `lifecycle_state`.
 *
 * Pre-conditions:
 *   - State carries a concealed deck (the MVP open-information
 *     path does NOT use Fold — In-Between v1 has no concealed
 *     hand).
 *   - The actor has at least one card in `ASSIGNED_CONCEALED`.
 *
 * Either failure returns INVALID_ACTION_FOR_STATE so the actor can
 * fall back to Pass on the MVP path.
 */
function applyFold(
  state: RoundState,
  action: FoldAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S8_BET_DECISION' && state.state_class !== 'S7_CARD_REVEAL_SECOND') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', `Fold outside S7/S8 (got ${state.state_class})`));
  }
  if (action.acting_player_seat === null) {
    return err(protocolError('SEAT_OUT_OF_RANGE', 'Fold requires acting_player_seat'));
  }
  if (state.concealed_deck === null) {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'Fold requires concealed_deck (extended model)'));
  }
  const seat = action.acting_player_seat;
  const seatIdx = state.players.findIndex((p) => p.seat === seat);
  if (seatIdx < 0) {
    return err(protocolError('PLAYER_NOT_SEATED', `seat ${seat}`));
  }
  const player = state.players[seatIdx]!;
  const holderPubkey = player.value_signing_pubkey;
  const surrendered: ConcealedCard[] = [];
  let touched = 0;
  for (const card of state.concealed_deck) {
    if (card.holder_pubkey === holderPubkey && card.lifecycle_state === 'ASSIGNED_CONCEALED') {
      surrendered.push({ ...card, lifecycle_state: 'SURRENDERED' });
      touched += 1;
    } else {
      surrendered.push(card);
    }
  }
  if (touched === 0) {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'Fold: player holds no ASSIGNED_CONCEALED cards'));
  }
  const players = [
    ...state.players.slice(0, seatIdx),
    { ...player, participation_status: 'folded' as const },
    ...state.players.slice(seatIdx + 1),
  ];
  return ok({
    ...state,
    players,
    concealed_deck: surrendered,
    state_class: 'S11_ROTATE_TURN',
    allowed_actions: getLegalActions('S11_ROTATE_TURN'),
    prior_state_hash: state.state_hash,
  });
}

function applySettle(
  state: RoundState,
  _action: SettleAction,
  ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S10_SETTLED_ROUND') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'Settle outside S10'));
  }
  if (state.visible_cards.length !== 3) {
    return err(protocolError(
      'INVALID_STATE_TRANSITION',
      `settle requires 3 visible cards, have ${state.visible_cards.length}`,
    ));
  }
  if (state.acting_player_seat === null) {
    return err(protocolError(
      'SEAT_OUT_OF_RANGE',
      'settle requires an acting_player_seat',
    ));
  }
  // The bet amount is recoverable from state.pot_value at the start of the
  // round; for simplicity the engine treats the most-recently-added bet as
  // the entire pot's most recent contribution. For In-Between v1 with a
  // single bet per round, the pot's full value is the bet. Production
  // implementations track the bet_amount on the S9 -> S10 transition.
  const bet = state.pot_value;
  const classification = classifyInBetweenRound(state.visible_cards);
  const { playerDelta, potDelta } = computeValueTransfer(
    classification.outcome,
    bet,
    ruleSet.settlement_rules,
  );
  const newPotRaw = state.pot_value + potDelta;
  if (!Number.isSafeInteger(newPotRaw) || newPotRaw < 0) {
    return err(protocolError('INVALID_STATE_TRANSITION', 'settlement produces negative pot'));
  }
  // Update the acting player's stake_at_risk by playerDelta (positive on win).
  const players = state.players.map((p) => {
    if (p.seat !== state.acting_player_seat) return p;
    const next = p.stake_at_risk + playerDelta;
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new Error('settlement produces negative balance');
    }
    return { ...p, stake_at_risk: asSatoshis(next) };
  });
  return ok({
    ...state,
    state_class: 'S11_ROTATE_TURN',
    pot_value: asSatoshis(newPotRaw),
    players,
    allowed_actions: getLegalActions('S11_ROTATE_TURN'),
    prior_state_hash: state.state_hash,
  });
}

function applyRotateTurn(
  state: RoundState,
  _action: RotateTurnAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S11_ROTATE_TURN') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'RotateTurn outside S11'));
  }
  // Find the next active seat after the current acting seat.
  const seats = state.players.map((p) => p.seat).sort((a, b) => a - b);
  if (seats.length === 0) {
    return err(protocolError('TABLE_NOT_LOCKABLE', 'no players to rotate'));
  }
  let nextSeat: Seat;
  if (state.acting_player_seat === null) {
    const first = seats[0];
    if (first === undefined) throw new Error('seats[0] missing');
    nextSeat = first;
  } else {
    const i = seats.indexOf(state.acting_player_seat);
    const idxRaw = (i + 1) % seats.length;
    const candidate = seats[idxRaw];
    if (candidate === undefined) throw new Error(`seats[${idxRaw}] missing`);
    nextSeat = candidate;
  }
  const firstSeat = seats[0];
  if (firstSeat === undefined) throw new Error('seats[0] missing');
  const wrappedToStart = state.acting_player_seat !== null && nextSeat === firstSeat;

  // If we wrapped, all players have acted at least once in this rotation
  // — advance to TABLE_CLOSE. Otherwise begin a new round at S6.
  if (wrappedToStart) {
    return ok({
      ...state,
      state_class: 'S12_TABLE_CLOSE',
      allowed_actions: getLegalActions('S12_TABLE_CLOSE'),
      prior_state_hash: state.state_hash,
    });
  }
  return ok({
    ...state,
    state_class: 'S6_CARD_REVEAL_FIRST',
    round_number: asRoundNumber(state.round_number + 1),
    acting_player_seat: nextSeat,
    visible_cards: [],
    allowed_actions: getLegalActions('S6_CARD_REVEAL_FIRST'),
    prior_state_hash: state.state_hash,
  });
}

function applyTableClose(
  state: RoundState,
  _action: TableCloseAction,
  _ruleSet: RuleSet,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S12_TABLE_CLOSE') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'TableClose outside S12'));
  }
  return ok({
    ...state,
    allowed_actions: [],
    prior_state_hash: state.state_hash,
  });
}

function applyTimeout(
  state: RoundState,
  _action: TimeoutAction,
  _ruleSet: RuleSet,
  currentHeight: BlockHeight,
): Result<RoundState, ProtocolError> {
  if (state.state_class !== 'S8_BET_DECISION') {
    // v1 timeout only applies at S8 BET_DECISION (default = pass).
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'Timeout only legal at S8 in v1'));
  }
  if (state.decision_deadline_block_height === null) {
    return err(protocolError('TIMEOUT_NOT_MATURE', 'no decision deadline'));
  }
  if (currentHeight < state.decision_deadline_block_height) {
    return err(protocolError(
      'TIMEOUT_NOT_MATURE',
      `current=${currentHeight}, deadline=${state.decision_deadline_block_height}`,
    ));
  }
  // Default consequence at S8 is pass: no economic change, advance to rotate.
  return ok({
    ...state,
    state_class: 'S11_ROTATE_TURN',
    allowed_actions: getLegalActions('S11_ROTATE_TURN'),
    prior_state_hash: state.state_hash,
  });
}

function applyRecovery(
  state: RoundState,
  _action: RecoveryAction,
  _ruleSet: RuleSet,
  currentHeight: BlockHeight,
): Result<RoundState, ProtocolError> {
  if (state.recovery_deadline_block_height === null) {
    return err(protocolError('RECOVERY_NOT_MATURE', 'no recovery deadline'));
  }
  if (currentHeight < state.recovery_deadline_block_height) {
    return err(protocolError(
      'RECOVERY_NOT_MATURE',
      `current=${currentHeight}, recovery=${state.recovery_deadline_block_height}`,
    ));
  }
  return ok({
    ...state,
    state_class: 'RECOVERED',
    allowed_actions: [],
    prior_state_hash: state.state_hash,
  });
}

// ---------------------------------------------------------------------------
// Settlement helper (exposed for callers)
// ---------------------------------------------------------------------------

/**
 * Compute the SettlementResult that `applySettle` would produce, without
 * actually transitioning the state. Useful for clients that want to show
 * the outcome before settling.
 */
export function computeSettlement(
  state: RoundState,
  ruleSet: RuleSet,
): Result<SettlementResult, ProtocolError> {
  if (state.state_class !== 'S10_SETTLED_ROUND') {
    return err(protocolError('INVALID_ACTION_FOR_STATE', 'computeSettlement requires S10 state'));
  }
  if (state.visible_cards.length !== 3 || state.acting_player_seat === null) {
    return err(protocolError('INVALID_STATE_TRANSITION', 'incomplete S10'));
  }
  const bet = state.pot_value;
  const classification = classifyInBetweenRound(state.visible_cards);
  const { playerDelta, potDelta } = computeValueTransfer(
    classification.outcome,
    bet,
    ruleSet.settlement_rules,
  );
  const balances = state.players.map((p) =>
    p.seat === state.acting_player_seat
      ? clampSat(p.stake_at_risk + playerDelta)
      : p.stake_at_risk,
  );
  return ok({
    round_state_hash: state.state_hash,
    outcome: classification.outcome,
    bet_amount: bet,
    acting_player_seat: state.acting_player_seat,
    amount_won_or_lost: asSatoshis(Math.abs(playerDelta)),
    resulting_pot_value: clampSat(state.pot_value + potDelta),
    resulting_balances: balances,
  });
}
