package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 13: Fee/amount miscalculation must be handled gracefully — the
// engine returns a typed error, never panics, when amounts are invalid.
func TestScenario13_OutOfRangeBetHandledGracefully(t *testing.T) {
	rs := ruleSet()
	s := betDecisionState(106)
	for _, amt := range []types.Satoshis{0, 1_000_000} { // below min, above max
		bet := types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionBet, ActionNonce: "bet",
			ActingPlayerSeat: seatPtr(0), BetAmount: amt,
		}
		_, err := engine.ApplyAction(s, bet, rs, types.BlockHeight(100))
		if err == nil || err.Code != types.ErrInvalidBetAmount {
			t.Errorf("scenario 13: bet %d want INVALID_BET_AMOUNT, got %v", amt, err)
		}
	}
}

// Scenario 13 (part 2): a malformed settlement (wrong number of visible
// cards) is rejected gracefully rather than producing a bad payout.
func TestScenario13_MalformedSettlementRejected(t *testing.T) {
	s := types.RoundState{
		StateClass:       types.StateSettledRound,
		GameId:           types.GameId(gameIdHex),
		ActingPlayerSeat: seatPtr(0),
		Players:          []types.PlayerState{{Seat: 0, StakeAtRisk: 1000}, {Seat: 1, StakeAtRisk: 1000}},
		PotValue:         10,
		VisibleCards:     []types.RevealedCard{{Rank: "5", Suit: "clubs", Ordinal: 5}, {Rank: "K", Suit: "hearts", Ordinal: 39}}, // only 2
		AllowedActions:   engine.GetLegalActions(types.StateSettledRound),
	}
	settle := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionSettle, ActionNonce: "s", ActingPlayerSeat: seatPtr(0)}
	_, err := engine.ApplyAction(s, settle, ruleSet(), types.BlockHeight(100))
	if err == nil || err.Code != types.ErrInvalidStateTransition {
		t.Errorf("scenario 13: malformed settle want INVALID_STATE_TRANSITION, got %v", err)
	}
}

// Invalid-branch guard: actions illegal for the current state class are
// rejected with INVALID_ACTION_FOR_STATE (the successor-template guard).
func TestInvalidBranch_IllegalActionsAtS1Rejected(t *testing.T) {
	rs := ruleSet()
	s := engine.InitialState(types.GameId(gameIdHex), "rh", types.BlockHeight(244))
	for _, at := range []types.ActionType{types.ActionCardReveal, types.ActionRotateTurn, types.ActionSettle, types.ActionBet} {
		a := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: at, ActionNonce: types.ActionNonce("x" + string(at))}
		_, err := engine.ApplyAction(s, a, rs, types.BlockHeight(100))
		if err == nil || err.Code != types.ErrInvalidActionForState {
			t.Errorf("invalid-branch: %s at S1 want INVALID_ACTION_FOR_STATE, got %v", at, err)
		}
	}
}
