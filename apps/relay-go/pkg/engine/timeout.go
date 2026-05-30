package engine

import "github.com/prof-faustus/cardtable/relay-go/pkg/types"

// Eligibility reports which branches (cooperative, timeout, recovery)
// are spendable at a given block height.
type Eligibility struct {
	CanCooperate bool
	CanTimeout   bool
	CanRecover   bool
}

// EligibilityFor returns the per-branch eligibility for a state at the
// given current block height.
func EligibilityFor(state *types.RoundState, currentHeight types.BlockHeight) Eligibility {
	e := Eligibility{
		CanCooperate: len(state.AllowedActions) > 0,
	}
	if state.DecisionDeadlineBlockHeight != nil && currentHeight >= *state.DecisionDeadlineBlockHeight {
		e.CanTimeout = true
	}
	if state.RecoveryDeadlineBlockHeight != nil && currentHeight >= *state.RecoveryDeadlineBlockHeight {
		e.CanRecover = true
	}
	return e
}

// ValidateTimeoutOrdering enforces decision_timeout < recovery_timeout
// (per spec/timeout-rules.md §3).
func ValidateTimeoutOrdering(decisionBlocks, recoveryBlocks int) bool {
	return decisionBlocks > 0 && recoveryBlocks > 0 && decisionBlocks < recoveryBlocks
}
