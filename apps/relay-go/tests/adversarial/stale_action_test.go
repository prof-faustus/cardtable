package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 6 (part 1): A Timeout submitted before the decision deadline
// is not yet mature and must be rejected.
func TestScenario06_TimeoutBeforeDeadlineRejected(t *testing.T) {
	s := betDecisionState(200)
	to := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTimeout, ActionNonce: "to"}
	_, err := engine.ApplyAction(s, to, ruleSet(), types.BlockHeight(100))
	if err == nil || err.Code != types.ErrTimeoutNotMature {
		t.Errorf("scenario 6: want TIMEOUT_NOT_MATURE, got %v", err)
	}
}

// Scenario 6 (part 2): Once a timeout has resolved the decision (S8→S11),
// a stale Bet that still references the pre-timeout state is rejected.
func TestScenario06_StaleBetAfterTimeoutRejected(t *testing.T) {
	rs := ruleSet()
	s := betDecisionState(106)
	to := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTimeout, ActionNonce: "to"}
	rotated, err := engine.ApplyAction(s, to, rs, types.BlockHeight(110))
	if err != nil {
		t.Fatalf("timeout rejected: %v", err)
	}
	staleBet := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionBet, ActionNonce: "lateBet",
		ActingPlayerSeat: seatPtr(0), BetAmount: 10,
	}
	_, berr := engine.ApplyAction(rotated, staleBet, rs, types.BlockHeight(111))
	if berr == nil || berr.Code != types.ErrInvalidActionForState {
		t.Errorf("scenario 6: stale bet after timeout want INVALID_ACTION_FOR_STATE, got %v", berr)
	}
}
