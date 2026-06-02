package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/internal/chain"
	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 11: Conflicting action transactions (double-spend) — the
// deterministic on-chain tie-break. Drives engine.PickConflictWinner
// through all three precedence tiers of spec/ordering-rules.md §3.1.
func TestScenario11_DoubleSpendOrderingResolution(t *testing.T) {
	lo := engine.TxConflictCandidate{TxId: types.TxId("aaaa000000000000000000000000000000000000000000000000000000000000")}
	hi := engine.TxConflictCandidate{TxId: types.TxId("bbbb000000000000000000000000000000000000000000000000000000000000")}

	// Tier 3: tie-break by lexicographically smaller txid.
	if w := engine.PickConflictWinner(lo, hi); w.TxId != lo.TxId {
		t.Errorf("tier3 txid tie-break: want lo, got %s", w.TxId)
	}
	// Tier 1: confirmed-in-block beats txid order.
	hiConf := hi
	hiConf.ConfirmedInBlock = true
	if w := engine.PickConflictWinner(lo, hiConf); w.TxId != hi.TxId {
		t.Errorf("tier1 confirmed: want hi, got %s", w.TxId)
	}
	// Tier 2: observed-by-quorum beats txid order when neither confirmed.
	hiQ := hi
	hiQ.ObservedByQuorum = true
	if w := engine.PickConflictWinner(lo, hiQ); w.TxId != hi.TxId {
		t.Errorf("tier2 quorum: want hi, got %s", w.TxId)
	}
	// Precedence: confirmation outranks quorum.
	loQ := lo
	loQ.ObservedByQuorum = true
	hiC := hi
	hiC.ConfirmedInBlock = true
	if w := engine.PickConflictWinner(loQ, hiC); w.TxId != hi.TxId {
		t.Errorf("precedence confirmed>quorum: want hi, got %s", w.TxId)
	}
}

// Reorg scenario (spec/ordering-rules.md §5): a fork block is orphaned by
// a competing chain. Reindex rewinds to the deepest common ancestor,
// forward-applies the new chain, and reports the orphaned actions.
func TestReorgRewindAndOrphan(t *testing.T) {
	initial := engine.InitialState(types.GameId(gameIdHex), "rh", types.BlockHeight(244))
	rs := ruleSet()

	join := func(seat int, nonce string) types.SignedAction {
		return types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: types.ActionNonce(nonce),
			ActingPlayerSeat: seatPtr(seat), PlayerPubkey: types.Pubkey33(pubkeys[seat]), StakeAmount: 1000,
		}
	}

	genesis := chain.Block{Hash: "g", Height: 101, Actions: []types.SignedAction{join(0, "g0")}}
	oldChain := []chain.Block{genesis, {Hash: "old", Height: 102, Actions: []types.SignedAction{join(1, "old1")}}}
	newChain := []chain.Block{genesis, {Hash: "new", Height: 102, Actions: []types.SignedAction{join(1, "new1")}}}

	res, perr := chain.Reindex(initial, rs, oldChain, newChain)
	if perr != nil {
		t.Fatalf("reindex: %v", perr)
	}
	if res.AncestorBlocks != 1 {
		t.Errorf("reorg: want common ancestor depth 1, got %d", res.AncestorBlocks)
	}
	if len(res.Orphaned) != 1 || res.Orphaned[0].ActionNonce != "old1" {
		t.Errorf("reorg: want the old fork's join orphaned, got %+v", res.Orphaned)
	}
	if len(res.State.Players) != 2 {
		t.Errorf("reorg: canonical state should reflect new chain (2 players), got %d", len(res.State.Players))
	}
}
