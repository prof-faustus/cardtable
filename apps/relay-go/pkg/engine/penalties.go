package engine

import (
	"fmt"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// ClassifyResult names the round outcome and whether the third card
// was actually consulted (penalty outcomes resolve before examining
// the third card).
type ClassifyResult struct {
	Outcome          types.SettlementOutcome
	ThirdCardChecked bool
}

// ClassifyInBetweenRound returns the outcome class for an In-Between
// round given the three visible cards. Per spec/card-protocol.md and
// the test vectors:
//
//   - if the first two cards share a rank-ord -> equal_penalty
//   - else if they are consecutive (rank-ord difference == 1) -> consecutive_penalty
//   - else if the third card's rank-ord is strictly between the two ->
//     win
//   - else -> loss
func ClassifyInBetweenRound(visible []types.RevealedCard) (ClassifyResult, error) {
	if len(visible) != 3 {
		return ClassifyResult{}, fmt.Errorf("ClassifyInBetweenRound: expected 3 visible cards, got %d", len(visible))
	}
	a := visible[0].Ordinal % 13
	b := visible[1].Ordinal % 13
	if a == b {
		return ClassifyResult{Outcome: types.OutcomeEqualPenalty, ThirdCardChecked: false}, nil
	}
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	if diff == 1 {
		return ClassifyResult{Outcome: types.OutcomeConsecutivePenalty, ThirdCardChecked: false}, nil
	}
	c := visible[2].Ordinal % 13
	low, high := a, b
	if a > b {
		low, high = b, a
	}
	if c > low && c < high {
		return ClassifyResult{Outcome: types.OutcomeWin, ThirdCardChecked: true}, nil
	}
	return ClassifyResult{Outcome: types.OutcomeLoss, ThirdCardChecked: true}, nil
}

// ValueTransfer is the signed delta of the active player's balance
// and the pot for one settlement. Conservation: PlayerDelta + PotDelta
// == 0.
type ValueTransfer struct {
	PlayerDelta int64
	PotDelta    int64
}

// ComputeValueTransfer is the pure (outcome, bet, rules) -> deltas
// function. Use int64 deltas so a loss can be a negative number;
// callers convert back to Satoshis at the call site.
func ComputeValueTransfer(outcome types.SettlementOutcome, bet types.Satoshis, rules types.SettlementRules) (ValueTransfer, error) {
	switch outcome {
	case types.OutcomeWin:
		win := int64(bet) * int64(rules.InBetweenWinMultiplier)
		return ValueTransfer{PlayerDelta: win, PotDelta: -win}, nil
	case types.OutcomeLoss:
		loss := int64(bet) * int64(rules.InBetweenLossMultiplier)
		return ValueTransfer{PlayerDelta: -loss, PotDelta: loss}, nil
	case types.OutcomePass:
		return ValueTransfer{PlayerDelta: 0, PotDelta: 0}, nil
	case types.OutcomeConsecutivePenalty:
		p := int64(rules.ConsecutiveCardsPenalty)
		return ValueTransfer{PlayerDelta: -p, PotDelta: p}, nil
	case types.OutcomeEqualPenalty:
		p := int64(rules.EqualCardsPenalty)
		return ValueTransfer{PlayerDelta: -p, PotDelta: p}, nil
	default:
		return ValueTransfer{}, fmt.Errorf("ComputeValueTransfer: unknown outcome %q", outcome)
	}
}
