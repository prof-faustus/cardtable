package chain

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Phase 6 on-chain adversarial scenario: REORG.
//
// A block that confirmed one or more game transactions is orphaned by
// a longer competing chain. spec/ordering-rules.md §5 requires the
// indexer to rewind to the deepest common ancestor and forward-apply
// the new chain. These tests prove Reindex (a) computes the same state
// a fresh replay of the new chain would, and (b) reports the actions
// orphaned by the reorg.

const chainGameId = "0000000000000000000000000000000000000000000000000000000000000006"
const chainPubkey = "02ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c"

func chainRuleSet() types.RuleSet {
	return types.RuleSet{
		GameType:              types.GameInBetween,
		PlayerCountMin:        2,
		PlayerCountMax:        4,
		StakeAmount:           1000,
		MinBet:                1,
		MaxBet:                100,
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

func joinAction(seat int, nonce string) types.SignedAction {
	return types.SignedAction{
		GameId:           types.GameId(chainGameId),
		ActionType:       types.ActionJoin,
		ActionNonce:      types.ActionNonce(nonce),
		ActingPlayerSeat: seatPtr(seat),
		PlayerPubkey:     types.Pubkey33(chainPubkey),
		StakeAmount:      1000,
	}
}

func seed() (types.RoundState, types.RuleSet) {
	rs := chainRuleSet()
	return engine.InitialState(types.GameId(chainGameId), types.RuleSetHash("0"), 244), rs
}

// TestReorg_OrphansForkBlockAndConverges builds a chain that forks at
// the third block: the old chain confirmed a Join(seat2) that the new
// chain never does. After Reindex the canonical state must (a) reflect
// only the new chain and (b) report the orphaned Join.
func TestReorg_OrphansForkBlockAndConverges(t *testing.T) {
	initial, rs := seed()

	// Shared prefix: two blocks each confirming one Join.
	b0 := Block{Hash: "blk0", Height: 100, Actions: []types.SignedAction{joinAction(0, "n0")}}
	b1 := Block{Hash: "blk1", Height: 101, Actions: []types.SignedAction{joinAction(1, "n1")}}

	// Old chain: a third block confirms Join(seat2), then is orphaned.
	oldFork := Block{Hash: "blk2-old", Height: 102, Actions: []types.SignedAction{joinAction(2, "n2")}}
	oldChain := []Block{b0, b1, oldFork}

	// New (winning) chain: the fork block is replaced by one with no
	// game actions, plus a further block that seats player 3 instead.
	newFork := Block{Hash: "blk2-new", Height: 102, Actions: nil}
	newTip := Block{Hash: "blk3-new", Height: 103, Actions: []types.SignedAction{joinAction(3, "n3")}}
	newChain := []Block{b0, b1, newFork, newTip}

	res, perr := Reindex(initial, rs, oldChain, newChain)
	if perr != nil {
		t.Fatalf("Reindex: %v", perr)
	}

	if res.AncestorBlocks != 2 {
		t.Errorf("common ancestor: want 2 shared blocks, got %d", res.AncestorBlocks)
	}

	// Orphaned must be exactly the old fork's Join(seat2).
	if len(res.Orphaned) != 1 || res.Orphaned[0].ActionNonce != "n2" {
		t.Fatalf("orphaned: want [n2], got %+v", res.Orphaned)
	}

	// Canonical state seats players 0,1,3 — never 2.
	if len(res.State.Players) != 3 {
		t.Fatalf("want 3 seated players after reindex, got %d", len(res.State.Players))
	}
	for _, p := range res.State.Players {
		if p.Seat == 2 {
			t.Errorf("seat 2 was orphaned but appears in canonical state")
		}
	}

	// Reindex must equal a from-scratch replay of the new chain — the
	// rewind+forward-apply path is observationally identical to a full
	// fold of the canonical transcript.
	allActions, allHeights := flatten(newChain)
	want, _, perr := engine.Replay(initial, rs, allActions, allHeights)
	if perr != nil {
		t.Fatalf("reference replay: %v", perr)
	}
	if want.StateClass != res.State.StateClass || len(want.Players) != len(res.State.Players) {
		t.Errorf("reindex state diverges from full replay: reindex=%+v replay=%+v", res.State, want)
	}
}

// TestReorg_NoCommonDivergenceIsIdentity verifies that when the new
// chain merely extends the old one (no orphaned blocks), nothing is
// reported orphaned and the ancestor is the whole old chain.
func TestReorg_ExtensionOrphansNothing(t *testing.T) {
	initial, rs := seed()

	b0 := Block{Hash: "blk0", Height: 100, Actions: []types.SignedAction{joinAction(0, "n0")}}
	b1 := Block{Hash: "blk1", Height: 101, Actions: []types.SignedAction{joinAction(1, "n1")}}
	oldChain := []Block{b0, b1}
	newChain := []Block{b0, b1, {Hash: "blk2", Height: 102, Actions: []types.SignedAction{joinAction(2, "n2")}}}

	res, perr := Reindex(initial, rs, oldChain, newChain)
	if perr != nil {
		t.Fatalf("Reindex: %v", perr)
	}
	if res.AncestorBlocks != 2 {
		t.Errorf("ancestor: want 2, got %d", res.AncestorBlocks)
	}
	if len(res.Orphaned) != 0 {
		t.Errorf("pure extension must orphan nothing, got %+v", res.Orphaned)
	}
	if len(res.State.Players) != 3 {
		t.Errorf("want 3 players, got %d", len(res.State.Players))
	}
}

// TestDeepestCommonAncestor covers the prefix matcher directly.
func TestDeepestCommonAncestor(t *testing.T) {
	mk := func(hashes ...string) []Block {
		bs := make([]Block, len(hashes))
		for i, h := range hashes {
			bs[i] = Block{Hash: h}
		}
		return bs
	}
	cases := []struct {
		name           string
		old, new       []Block
		wantAncestorAt int
	}{
		{"identical", mk("a", "b", "c"), mk("a", "b", "c"), 3},
		{"fork at 2", mk("a", "b", "x"), mk("a", "b", "y"), 2},
		{"fork at 0", mk("a"), mk("z"), 0},
		{"new longer", mk("a", "b"), mk("a", "b", "c"), 2},
		{"old longer", mk("a", "b", "c"), mk("a", "b"), 2},
		{"empty old", nil, mk("a"), 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := DeepestCommonAncestor(tc.old, tc.new); got != tc.wantAncestorAt {
				t.Errorf("want %d, got %d", tc.wantAncestorAt, got)
			}
		})
	}
}
