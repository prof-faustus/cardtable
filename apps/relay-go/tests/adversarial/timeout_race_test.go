package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 4: Disconnect before betting — after the decision deadline a
// Timeout applies the default consequence (pass), rotating the turn.
func TestScenario04_TimeoutAppliesPassDefault(t *testing.T) {
	s := betDecisionState(106)
	to := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTimeout, ActionNonce: "to"}
	next, err := engine.ApplyAction(s, to, ruleSet(), types.BlockHeight(110)) // mature
	if err != nil {
		t.Fatalf("mature timeout rejected: %v", err)
	}
	if next.StateClass != types.StateRotateTurn {
		t.Errorf("scenario 4: want S11_ROTATE_TURN after timeout, got %s", next.StateClass)
	}
}

// Scenario 7: Two clients disagree on timeout canonicity. The engine is a
// pure deterministic function: two distinct Timeout actions for the same
// state produce a byte-identical successor, so honest peers converge.
func TestScenario07_TimeoutResolutionIsDeterministic(t *testing.T) {
	s := betDecisionState(106)
	rs := ruleSet()
	a := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTimeout, ActionNonce: "toA"}
	b := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTimeout, ActionNonce: "toB"}

	na, errA := engine.ApplyAction(s, a, rs, types.BlockHeight(110))
	nb, errB := engine.ApplyAction(s, b, rs, types.BlockHeight(110))
	if errA != nil || errB != nil {
		t.Fatalf("timeout rejected: %v / %v", errA, errB)
	}
	if na.StateClass != nb.StateClass || na.PotValue != nb.PotValue {
		t.Errorf("scenario 7: timeout resolution diverged: %s/%d vs %s/%d",
			na.StateClass, na.PotValue, nb.StateClass, nb.PotValue)
	}
	if (na.ActingPlayerSeat == nil) != (nb.ActingPlayerSeat == nil) {
		t.Errorf("scenario 7: acting-seat presence diverged")
	}
}
