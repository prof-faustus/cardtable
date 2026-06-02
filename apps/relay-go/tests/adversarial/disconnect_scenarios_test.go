package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// recoveryAction is the global unwind trigger.
func recoveryAction() types.SignedAction {
	return types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionRecovery, ActionNonce: "rec", RecoveryTrigger: "disconnect"}
}

// Scenario 1: Disconnect before funding. From the freshly opened table,
// once the recovery deadline matures the global recovery branch unwinds
// the round (refund path) and no player can act afterwards.
func TestScenario01_DisconnectBeforeFundingRecovers(t *testing.T) {
	s := engine.InitialState(types.GameId(gameIdHex), "rh", types.BlockHeight(244))
	next, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(300))
	if err != nil {
		t.Fatalf("recovery rejected: %v", err)
	}
	if next.StateClass != types.StateRecovered {
		t.Errorf("scenario 1: want RECOVERED, got %s", next.StateClass)
	}
	if len(next.AllowedActions) != 0 {
		t.Errorf("scenario 1: recovered state must allow no further actions, got %v", next.AllowedActions)
	}
}

// Scenario 2: Disconnect after funding, before the shuffle (at the
// entropy-commit window). Recovery still unwinds once mature.
func TestScenario02_DisconnectBeforeShuffleRecovers(t *testing.T) {
	s := types.RoundState{
		StateClass:                  types.StateEntropyCommit,
		GameId:                      types.GameId(gameIdHex),
		Players:                     []types.PlayerState{{Seat: 0, StakeAtRisk: 1000}, {Seat: 1, StakeAtRisk: 1000}},
		AllowedActions:              engine.GetLegalActions(types.StateEntropyCommit),
		RecoveryDeadlineBlockHeight: bh(244),
	}
	next, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(244))
	if err != nil {
		t.Fatalf("recovery rejected: %v", err)
	}
	if next.StateClass != types.StateRecovered {
		t.Errorf("scenario 2: want RECOVERED, got %s", next.StateClass)
	}
}

// Scenario 5: Disconnect after betting, before the third card reveal.
// At S9 the acting player has gone silent; recovery unwinds once mature.
func TestScenario05_DisconnectBeforeThirdRevealRecovers(t *testing.T) {
	s := types.RoundState{
		StateClass:                  types.StateCardRevealThird,
		GameId:                      types.GameId(gameIdHex),
		ActingPlayerSeat:            seatPtr(0),
		Players:                     []types.PlayerState{{Seat: 0, StakeAtRisk: 1000}, {Seat: 1, StakeAtRisk: 1000}},
		PotValue:                    10,
		AllowedActions:              engine.GetLegalActions(types.StateCardRevealThird),
		RecoveryDeadlineBlockHeight: bh(244),
	}
	next, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(250))
	if err != nil {
		t.Fatalf("recovery rejected: %v", err)
	}
	if next.StateClass != types.StateRecovered {
		t.Errorf("scenario 5: want RECOVERED, got %s", next.StateClass)
	}
}
