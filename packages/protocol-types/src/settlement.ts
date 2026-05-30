/**
 * Settlement and recovery records.
 */

import type { Hash256, Satoshis, Seat } from './primitives.js';

/** Outcome classes for one round in In-Between. */
export type SettlementOutcome =
  | 'win'
  | 'loss'
  | 'pass'
  | 'consecutive_penalty'
  | 'equal_penalty';

/** Result of a {@link SettleAction}. */
export interface SettlementResult {
  readonly round_state_hash: Hash256;
  readonly outcome: SettlementOutcome;
  readonly bet_amount: Satoshis;
  readonly acting_player_seat: Seat;
  readonly amount_won_or_lost: Satoshis;
  readonly resulting_pot_value: Satoshis;
  /** Per-seat balances after this settlement. */
  readonly resulting_balances: readonly Satoshis[];
}

/** Record of a recovery action's effect on the session. */
export interface RecoveryRecord {
  readonly stalled_state_hash: Hash256;
  readonly recovery_trigger: string;
  readonly final_distribution: readonly {
    readonly seat: Seat;
    readonly refund_sats: Satoshis;
    readonly penalty_paid_sats: Satoshis;
    readonly penalty_received_sats: Satoshis;
  }[];
  readonly penalty_burnt_sats: Satoshis;
}
