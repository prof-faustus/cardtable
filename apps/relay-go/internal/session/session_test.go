package session

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

const samplePubkey = "02ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c"

func makeRuleSet() types.RuleSet {
	return types.RuleSet{
		GameType:             types.GameInBetween,
		PlayerCountMin:       2,
		PlayerCountMax:       4,
		StakeAmount:          1000,
		MinBet:               1,
		MaxBet:               100,
		DecisionTimeoutBlocks: 6,
		RecoveryTimeoutBlocks: 144,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
		},
	}
}

func seatPtr(s int) *types.Seat {
	v := types.Seat(s)
	return &v
}

func TestSessionSubmitAdvancesState(t *testing.T) {
	rs := makeRuleSet()
	sess := New(types.GameId("a"), rs, "rh", 144)

	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: seatPtr(0),
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}
	next, perr := sess.Submit(join, 100)
	if perr != nil {
		t.Fatalf("Submit: %v", perr)
	}
	if len(next.Players) != 1 {
		t.Errorf("want 1 player after join, got %d", len(next.Players))
	}
}

func TestSessionRejectsDuplicateNonce(t *testing.T) {
	rs := makeRuleSet()
	sess := New(types.GameId("a"), rs, "rh", 144)

	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: seatPtr(0),
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}
	if _, err := sess.Submit(join, 100); err != nil {
		t.Fatalf("first Submit: %v", err)
	}
	join2 := join
	join2.ActingPlayerSeat = seatPtr(1)
	_, err := sess.Submit(join2, 101)
	if err == nil {
		t.Fatal("want STALE_STATE on duplicate nonce, got nil")
	}
	if err.Code != types.ErrStaleState {
		t.Errorf("want STALE_STATE, got %s", err.Code)
	}
}

func TestSessionReplayReproducesState(t *testing.T) {
	rs := makeRuleSet()
	sess := New(types.GameId("a"), rs, "rh", 144)

	// Two valid joins.
	for i := 0; i < 2; i++ {
		nonce := types.ActionNonce("n0")
		if i == 1 {
			nonce = "n1"
		}
		join := types.SignedAction{
			GameId:           "a",
			ActionType:       types.ActionJoin,
			ActionNonce:      nonce,
			ActingPlayerSeat: seatPtr(i),
			PlayerPubkey:     types.Pubkey33(samplePubkey),
			StakeAmount:      1000,
		}
		if _, err := sess.Submit(join, 100); err != nil {
			t.Fatalf("Submit %d: %v", i, err)
		}
	}

	replayed, perr := sess.Replay("rh", 144)
	if perr != nil {
		t.Fatalf("Replay: %v", perr)
	}
	live := sess.State()
	if len(replayed.Players) != len(live.Players) {
		t.Errorf("replay player count differs: %d vs %d", len(replayed.Players), len(live.Players))
	}
	if replayed.StateClass != live.StateClass {
		t.Errorf("replay state_class differs: %s vs %s", replayed.StateClass, live.StateClass)
	}
}
