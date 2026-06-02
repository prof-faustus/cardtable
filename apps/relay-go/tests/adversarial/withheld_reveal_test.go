package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 3 (part 1): a player tries to reveal entropy before the
// commit window has closed (only one seat committed). The state is still
// S3, so EntropyReveal is not a legal action and is rejected.
func TestScenario03_RevealBeforeCommitWindowClosedRejected(t *testing.T) {
	sess := newSession()
	submit := func(a types.SignedAction) {
		if _, err := sess.Submit(a, 100); err != nil {
			t.Fatalf("%s rejected: %v", a.ActionType, err)
		}
	}
	for i := 0; i < 2; i++ {
		submit(types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: types.ActionNonce("j" + string(rune('0'+i))),
			ActingPlayerSeat: seatPtr(i), PlayerPubkey: types.Pubkey33(pubkeys[i]), StakeAmount: 1000,
		})
	}
	submit(types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTableLock, ActionNonce: "lock"})
	// Only seat 1 commits; window stays open at S3.
	submit(types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionEntropyCommit, ActionNonce: "c1",
		ActingPlayerSeat: seatPtr(1), CommitmentHash: types.Hash256(commitmentHexFor(t, 1)),
	})
	// Seat 0 tries to reveal before its own commit — rejected. The crypto
	// gate fires first (no prior commitment → INVALID_STATE_TRANSITION);
	// absent that, the S3 state-class guard would reject it as
	// INVALID_ACTION_FOR_STATE. Either is a correct refusal.
	_, err := sess.Submit(types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionEntropyReveal, ActionNonce: "r0",
		ActingPlayerSeat: seatPtr(0), Entropy: types.Hash256(entropies[0]),
	}, 100)
	if err == nil || (err.Code != types.ErrInvalidStateTransition && err.Code != types.ErrInvalidActionForState) {
		t.Errorf("scenario 3: want INVALID_STATE_TRANSITION or INVALID_ACTION_FOR_STATE, got %v", err)
	}
}

// Scenario 3 (part 2): one player withholds their reveal at S4. The
// round cannot progress; once the recovery deadline matures the global
// recovery branch unwinds it (refund + non-reveal penalty per rule set).
func TestScenario03_WithheldRevealRecoversAtDeadline(t *testing.T) {
	s := types.RoundState{
		StateClass: types.StateEntropyReveal,
		GameId:     types.GameId(gameIdHex),
		Players: []types.PlayerState{
			{Seat: 0, StakeAtRisk: 1000, EntropyCommitted: true, EntropyRevealed: true, EntropyValue: types.Hash256(entropies[0])},
			{Seat: 1, StakeAtRisk: 1000, EntropyCommitted: true, EntropyRevealed: false}, // withheld
		},
		AllowedActions:              engine.GetLegalActions(types.StateEntropyReveal),
		RecoveryDeadlineBlockHeight: bh(244),
	}
	next, err := engine.ApplyAction(s, recoveryAction(), ruleSet(), types.BlockHeight(300))
	if err != nil {
		t.Fatalf("recovery rejected: %v", err)
	}
	if next.StateClass != types.StateRecovered {
		t.Errorf("scenario 3: withheld-reveal recovery want RECOVERED, got %s", next.StateClass)
	}
}
