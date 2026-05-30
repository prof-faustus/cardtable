package types

// SettlementOutcome enumerates the resolution classes for one
// In-Between round.
type SettlementOutcome string

const (
	OutcomeWin                 SettlementOutcome = "win"
	OutcomeLoss                SettlementOutcome = "loss"
	OutcomePass                SettlementOutcome = "pass"
	OutcomeConsecutivePenalty  SettlementOutcome = "consecutive_penalty"
	OutcomeEqualPenalty        SettlementOutcome = "equal_penalty"
)

// SettlementResult is the result of a Settle action.
type SettlementResult struct {
	RoundStateHash      Hash256           `json:"round_state_hash"`
	Outcome             SettlementOutcome `json:"outcome"`
	BetAmount           Satoshis          `json:"bet_amount"`
	ActingPlayerSeat    Seat              `json:"acting_player_seat"`
	AmountWonOrLost     Satoshis          `json:"amount_won_or_lost"`
	ResultingPotValue   Satoshis          `json:"resulting_pot_value"`
	ResultingBalances   []Satoshis        `json:"resulting_balances"`
}

// RecoveryRecord captures one global recovery outcome.
type RecoveryRecord struct {
	StalledStateHash    Hash256                     `json:"stalled_state_hash"`
	RecoveryTrigger     string                      `json:"recovery_trigger"`
	FinalDistribution   []RecoveryDistributionEntry `json:"final_distribution"`
	PenaltyBurntSats    Satoshis                    `json:"penalty_burnt_sats"`
}

// RecoveryDistributionEntry is one party's row in the recovery payout.
type RecoveryDistributionEntry struct {
	Seat                 Seat     `json:"seat"`
	RefundSats           Satoshis `json:"refund_sats"`
	PenaltyPaidSats      Satoshis `json:"penalty_paid_sats"`
	PenaltyReceivedSats  Satoshis `json:"penalty_received_sats"`
}
