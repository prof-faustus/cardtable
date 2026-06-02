package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Recovery maturity: before the recovery deadline the global recovery
// branch is not yet spendable.
func TestRecoveryBeforeDeadlineRejected(t *testing.T) {
	s := engine.InitialState(types.GameId(gameIdHex), "rh", types.BlockHeight(500))
	_, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(100))
	if err == nil || err.Code != types.ErrRecoveryNotMature {
		t.Errorf("recovery before deadline want RECOVERY_NOT_MATURE, got %v", err)
	}
}

// Scenario 8: Settlement broadcast delayed. The round is sitting at S10
// awaiting Settle; if that never lands, the recovery deadline eventually
// matures and the recovery branch unwinds the round.
func TestScenario08_DelayedSettlementRecovers(t *testing.T) {
	s := types.RoundState{
		StateClass:                  types.StateSettledRound,
		GameId:                      types.GameId(gameIdHex),
		ActingPlayerSeat:            seatPtr(0),
		Players:                     []types.PlayerState{{Seat: 0, StakeAtRisk: 1000}, {Seat: 1, StakeAtRisk: 1000}},
		PotValue:                    10,
		VisibleCards:                []types.RevealedCard{{Ordinal: 5}, {Ordinal: 39}, {Ordinal: 20}},
		AllowedActions:              engine.GetLegalActions(types.StateSettledRound),
		RecoveryDeadlineBlockHeight: bh(244),
	}
	next, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(244))
	if err != nil {
		t.Fatalf("recovery rejected: %v", err)
	}
	if next.StateClass != types.StateRecovered {
		t.Errorf("scenario 8: want RECOVERED, got %s", next.StateClass)
	}
}

// Scenario 14: All players disconnect → global recovery unwind. From a
// mid-round state with the table fully populated, once mature the
// recovery branch lands on RECOVERED and no further actions are allowed.
func TestScenario14_AllPlayersDisconnectGlobalRecovery(t *testing.T) {
	s := betDecisionState(106)
	s.RecoveryDeadlineBlockHeight = bh(244)
	next, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(500))
	if err != nil {
		t.Fatalf("recovery rejected: %v", err)
	}
	if next.StateClass != types.StateRecovered {
		t.Errorf("scenario 14: want RECOVERED, got %s", next.StateClass)
	}
	if len(next.AllowedActions) != 0 {
		t.Errorf("scenario 14: recovered state must allow no actions, got %v", next.AllowedActions)
	}
}
