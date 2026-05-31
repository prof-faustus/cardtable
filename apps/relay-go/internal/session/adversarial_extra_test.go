package session

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Additional adversarial scenarios bringing Go parity with the TS
// suite at packages/state-engine/__tests__/adversarial-scenarios.test.ts.
// Uses helpers + constants already defined in adversarial_test.go.

func TestAdvA05_TimeoutBeforeDeadline(t *testing.T) {
	deadline := types.BlockHeight(200)
	// Construct an S8 state with a deadline and try to timeout at h=100.
	s := types.RoundState{
		StateClass:                  types.StateBetDecision,
		GameId:                      types.GameId(advGameIdHex),
		AllowedActions:              engine.GetLegalActions(types.StateBetDecision),
		DecisionDeadlineBlockHeight: &deadline,
	}
	action := types.SignedAction{
		GameId:     types.GameId(advGameIdHex),
		ActionType: types.ActionTimeout,
	}
	_, err := engine.ApplyAction(s, action, adversarialRuleSet(), types.BlockHeight(100))
	if err == nil || err.Code != types.ErrTimeoutNotMature {
		t.Errorf("A05: want TIMEOUT_NOT_MATURE, got %v", err)
	}
}

func TestAdvA06_RecoveryBeforeDeadline(t *testing.T) {
	deadline := types.BlockHeight(500)
	s := types.RoundState{
		StateClass:                  types.StateBetDecision,
		GameId:                      types.GameId(advGameIdHex),
		AllowedActions:              engine.GetLegalActions(types.StateBetDecision),
		RecoveryDeadlineBlockHeight: &deadline,
	}
	action := types.SignedAction{
		GameId:     types.GameId(advGameIdHex),
		ActionType: types.ActionRecovery,
	}
	_, err := engine.ApplyAction(s, action, adversarialRuleSet(), types.BlockHeight(100))
	if err == nil || err.Code != types.ErrRecoveryNotMature {
		t.Errorf("A06: want RECOVERY_NOT_MATURE, got %v", err)
	}
}

func TestAdvA08_SettleFromS1(t *testing.T) {
	sess := New(types.GameId(advGameIdHex), adversarialRuleSet(), "rh", 144)
	seat0 := types.Seat(0)
	settle := types.SignedAction{
		GameId:           types.GameId(advGameIdHex),
		ActionType:       types.ActionSettle,
		ActionNonce:      "ab",
		ActingPlayerSeat: &seat0,
	}
	_, err := sess.Submit(settle, 100)
	if err == nil || err.Code != types.ErrInvalidActionForState {
		t.Errorf("A08: want INVALID_ACTION_FOR_STATE, got %v", err)
	}
}

func TestAdvA09_BetExceedsMaxBet(t *testing.T) {
	seat0 := types.Seat(0)
	s := types.RoundState{
		StateClass:       types.StateBetDecision,
		GameId:           types.GameId(advGameIdHex),
		ActingPlayerSeat: &seat0,
		AllowedActions:   engine.GetLegalActions(types.StateBetDecision),
	}
	overshoot := types.SignedAction{
		GameId:           types.GameId(advGameIdHex),
		ActionType:       types.ActionBet,
		ActingPlayerSeat: &seat0,
		BetAmount:        1_000_000, // far above ruleSet.MaxBet = 100
	}
	_, err := engine.ApplyAction(s, overshoot, adversarialRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidBetAmount {
		t.Errorf("A09: want INVALID_BET_AMOUNT, got %v", err)
	}
}
