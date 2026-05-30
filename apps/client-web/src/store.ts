/**
 * Zustand store for the open-information prototype.
 *
 * Phase 3c.1 wires the UI directly to the in-process state-engine.
 * Phase 3c.2 will swap the local engine for a `RelayClient` that
 * speaks the binary wire protocol over a WebSocket.
 */

import {
  applyAction,
  computeSettlement,
  initialState,
} from '@cardtable/state-engine';
import {
  asActionNonce,
  asBlockHeight,
  asGameId,
  asHash256,
  asPubkey33,
  asRoundNumber,
  asRuleSetHash,
  asSatoshis,
  asSeat,
  cardFromOrdinal,
} from '@cardtable/protocol-types';
import type {
  BlockHeight,
  ProtocolError,
  RoundState,
  RuleSet,
  Satoshis,
  Seat,
  SettlementResult,
  SignedAction,
} from '@cardtable/protocol-types';
import { create } from 'zustand';

const GAME_ID = asGameId('a'.repeat(64));
const RULE_HASH = asRuleSetHash('b'.repeat(64));
const RECOVERY_DEADLINE = asBlockHeight(244);

const PUB_0 = asPubkey33('02' + '00'.repeat(32));
const PUB_1 = asPubkey33('02' + '01'.repeat(32));

function defaultRuleSet(): RuleSet {
  return {
    game_type: 'in_between',
    player_count_min: 2,
    player_count_max: 4,
    stake_amount: asSatoshis(1000),
    min_bet: asSatoshis(1),
    max_bet: asSatoshis(100),
    decision_timeout_blocks: 6,
    recovery_timeout_blocks: 144,
    invitation_window_blocks: 18,
    default_action_by_state: { S8_BET_DECISION: 'pass' },
    penalty_schedule: {
      non_reveal: asSatoshis(100),
      bad_reveal: asSatoshis(200),
      consecutive_cards: asSatoshis(50),
      equal_cards: asSatoshis(100),
    },
    deck_format: 52,
    shuffle_algorithm_version: 1,
    settlement_rules: {
      in_between_win_multiplier: 1,
      in_between_loss_multiplier: 1,
      consecutive_cards_penalty: asSatoshis(50),
      equal_cards_penalty: asSatoshis(100),
    },
    recovery_rules: {
      refund_stakes_to_funders: true,
      apply_non_reveal_penalty: true,
      apply_bad_reveal_penalty: true,
    },
    serialisation_version: 1,
  };
}

let nonceCounter = 0;
function nextNonce(): SignedAction['action_nonce'] {
  nonceCounter += 1;
  return asActionNonce(nonceCounter.toString(16).padStart(64, '0'));
}

interface RecentError {
  readonly at: number;
  readonly code: ProtocolError['code'];
  readonly context: string;
}

interface TableStore {
  readonly state: RoundState;
  readonly ruleSet: RuleSet;
  readonly height: BlockHeight;
  readonly lastError: RecentError | null;
  readonly settlement: SettlementResult | null;

  reset: () => void;
  setHeight: (h: number) => void;

  seatJoin: (seat: Seat) => void;
  tableLock: () => void;
  entropyCommit: (seat: Seat) => void;
  entropyReveal: (seat: Seat) => void;
  revealCard: (ordinal: number) => void;
  placeBet: (amount: Satoshis) => void;
  pass: () => void;
  settle: (seat: Seat) => void;
}

function startState(): RoundState {
  return initialState(GAME_ID, RULE_HASH, RECOVERY_DEADLINE);
}

function pubkeyForSeat(seat: Seat): ReturnType<typeof asPubkey33> {
  return seat === 0 ? PUB_0 : PUB_1;
}

export const useTableStore = create<TableStore>((set, get) => ({
  state: startState(),
  ruleSet: defaultRuleSet(),
  height: asBlockHeight(100),
  lastError: null,
  settlement: null,

  reset: () => {
    nonceCounter = 0;
    set({
      state: startState(),
      ruleSet: defaultRuleSet(),
      height: asBlockHeight(100),
      lastError: null,
      settlement: null,
    });
  },

  setHeight: (h) => set({ height: asBlockHeight(h) }),

  seatJoin: (seat) => {
    const { state, ruleSet, height } = get();
    const action: SignedAction = {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'Join',
      action_nonce: nextNonce(),
      acting_player_seat: seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      player_pubkey: pubkeyForSeat(seat),
      stake_amount: ruleSet.stake_amount,
    };
    apply(set, state, ruleSet, action, height);
  },

  tableLock: () => {
    const { state, ruleSet, height } = get();
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'TableLock',
      action_nonce: nextNonce(),
      acting_player_seat: null,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
    }, height);
  },

  entropyCommit: (seat) => {
    const { state, ruleSet, height } = get();
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'EntropyCommit',
      action_nonce: nextNonce(),
      acting_player_seat: seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      commitment_hash: asHash256('11'.repeat(32)),
    }, height);
  },

  entropyReveal: (seat) => {
    const { state, ruleSet, height } = get();
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'EntropyReveal',
      action_nonce: nextNonce(),
      acting_player_seat: seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      entropy: asHash256('22'.repeat(32)),
    }, height);
  },

  revealCard: (ordinal) => {
    const { state, ruleSet, height } = get();
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'CardReveal',
      action_nonce: nextNonce(),
      acting_player_seat: null,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      reveal: {
        position: ordinal,
        revealed_card: cardFromOrdinal(ordinal),
        card_nonce: asHash256('33'.repeat(32)),
        deck_nonce: asHash256('44'.repeat(32)),
      },
    }, height);
  },

  placeBet: (amount) => {
    const { state, ruleSet, height } = get();
    const seat = state.acting_player_seat ?? asSeat(0);
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'BetAction',
      action_nonce: nextNonce(),
      acting_player_seat: seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      bet_amount: amount,
    }, height);
  },

  pass: () => {
    const { state, ruleSet, height } = get();
    const seat = state.acting_player_seat ?? asSeat(0);
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'Pass',
      action_nonce: nextNonce(),
      acting_player_seat: seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
    }, height);
  },

  settle: (seat) => {
    const { state, ruleSet, height } = get();
    apply(set, state, ruleSet, {
      game_id: state.game_id,
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'Settle',
      action_nonce: nextNonce(),
      acting_player_seat: seat,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
    }, height, true);
  },
}));

type Setter = (partial: Partial<TableStore>) => void;

function apply(
  setFn: Setter,
  state: RoundState,
  ruleSet: RuleSet,
  action: SignedAction,
  height: BlockHeight,
  computeSettle = false,
): void {
  const result = applyAction(state, action, ruleSet, height);
  if (!result.ok) {
    setFn({
      lastError: {
        at: Date.now(),
        code: result.error.code,
        context: result.error.context ?? '',
      },
    });
    return;
  }
  const next = result.value;
  let settlement: SettlementResult | null = null;
  if (computeSettle && state.state_class === 'S10_SETTLED_ROUND') {
    const s = computeSettlement(state, ruleSet);
    if (s.ok) settlement = s.value;
  }
  setFn({ state: next, lastError: null, ...(settlement ? { settlement } : {}) });
}
