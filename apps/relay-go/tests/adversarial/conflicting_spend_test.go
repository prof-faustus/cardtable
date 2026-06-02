package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 11: Conflicting action transactions (double-spend). Two
// distinct BetAction submissions reference the same S8 state. Exactly one
// can be accepted; the engine advances on the first, and the second —
// now referencing a superseded state — is rejected. (The on-chain txid
// tie-break that decides WHICH of two simultaneously-broadcast txs wins
// is covered deterministically in chain_scenarios_test.go and the
// tx-simulator conformance test.)
func TestScenario11_ConflictingBetsSingleAccepted(t *testing.T) {
	sess := driveToBetDecision(t)
	if got := sess.State().StateClass; got != types.StateBetDecision {
		t.Fatalf("precondition: want S8, got %s", got)
	}
	betA := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionBet, ActionNonce: "betA",
		ActingPlayerSeat: seatPtr(0), BetAmount: 10,
	}
	betB := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionBet, ActionNonce: "betB",
		ActingPlayerSeat: seatPtr(0), BetAmount: 20,
	}
	if _, err := sess.Submit(betA, 100); err != nil {
		t.Fatalf("first bet rejected: %v", err)
	}
	if got := sess.State().StateClass; got != types.StateCardRevealThird {
		t.Fatalf("after first bet want S9, got %s", got)
	}
	// The conflicting second bet now targets a superseded state.
	_, err := sess.Submit(betB, 100)
	if err == nil || err.Code != types.ErrInvalidActionForState {
		t.Errorf("scenario 11: conflicting second bet want INVALID_ACTION_FOR_STATE, got %v", err)
	}
	// Only the first bet entered the pot.
	if got := sess.State().PotValue; got != 10 {
		t.Errorf("scenario 11: pot should reflect only the accepted bet (10), got %d", got)
	}
}
