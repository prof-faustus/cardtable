package adversarial

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/internal/chain"
	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// These tests bind the new spec/test-vectors fixtures to the real Go
// implementation, so the canonical cross-language fixtures are not just
// documentation — they are executed against the production primitives.

func loadVector(t *testing.T, name string, into any) {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "spec", "test-vectors", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("unmarshal %s: %v", name, err)
	}
}

func TestVector_MempoolEviction(t *testing.T) {
	var v struct {
		RebroadcastMax              int      `json:"rebroadcast_max"`
		TxId                        string   `json:"txid"`
		Observations                []string `json:"observations"`
		ExpectedEvents              []string `json:"expected_events"`
		ExpectedRebroadcastAttempts []int    `json:"expected_rebroadcast_attempts"`
	}
	loadVector(t, "mempool-eviction.json", &v)

	tr := chain.NewTracker(v.RebroadcastMax)
	txid := types.TxId(v.TxId)
	tr.Relay(txid)

	statusOf := map[string]chain.TxStatus{
		"in_mempool":     chain.StatusInMempool,
		"confirmed":      chain.StatusConfirmed,
		"not_in_mempool": chain.StatusNotInMempool,
	}
	for i, obs := range v.Observations {
		e := tr.Observe(txid, statusOf[obs])
		if e.Kind.String() != v.ExpectedEvents[i] {
			t.Errorf("step %d (%s): want event %s, got %s", i, obs, v.ExpectedEvents[i], e.Kind)
		}
		if e.Attempt != v.ExpectedRebroadcastAttempts[i] {
			t.Errorf("step %d: want attempt %d, got %d", i, v.ExpectedRebroadcastAttempts[i], e.Attempt)
		}
	}
}

func TestVector_ReorgRestart(t *testing.T) {
	type blockSpec struct {
		Hash   string `json:"hash"`
		Height int    `json:"height"`
		Joins  []struct {
			Seat  int    `json:"seat"`
			Nonce string `json:"nonce"`
		} `json:"joins"`
	}
	var v struct {
		GameId                string      `json:"game_id"`
		OldChain              []blockSpec `json:"old_chain"`
		NewChain              []blockSpec `json:"new_chain"`
		ExpectedAncestorBlocks int        `json:"expected_ancestor_blocks"`
		ExpectedOrphanedNonces []string   `json:"expected_orphaned_nonces"`
		ExpectedPlayerCount    int        `json:"expected_player_count"`
	}
	loadVector(t, "reorg-restart.json", &v)

	toBlocks := func(specs []blockSpec) []chain.Block {
		out := make([]chain.Block, len(specs))
		for i, b := range specs {
			actions := make([]types.SignedAction, len(b.Joins))
			for j, jn := range b.Joins {
				actions[j] = types.SignedAction{
					GameId: types.GameId(v.GameId), ActionType: types.ActionJoin, ActionNonce: types.ActionNonce(jn.Nonce),
					ActingPlayerSeat: seatPtr(jn.Seat), PlayerPubkey: types.Pubkey33(pubkeys[jn.Seat]), StakeAmount: 1000,
				}
			}
			out[i] = chain.Block{Hash: b.Hash, Height: types.BlockHeight(b.Height), Actions: actions}
		}
		return out
	}

	initial := engine.InitialState(types.GameId(v.GameId), "rh", types.BlockHeight(244))
	res, perr := chain.Reindex(initial, ruleSet(), toBlocks(v.OldChain), toBlocks(v.NewChain))
	if perr != nil {
		t.Fatalf("reindex: %v", perr)
	}
	if res.AncestorBlocks != v.ExpectedAncestorBlocks {
		t.Errorf("ancestor blocks: want %d, got %d", v.ExpectedAncestorBlocks, res.AncestorBlocks)
	}
	if len(res.Orphaned) != len(v.ExpectedOrphanedNonces) {
		t.Fatalf("orphaned count: want %d, got %d", len(v.ExpectedOrphanedNonces), len(res.Orphaned))
	}
	for i, n := range v.ExpectedOrphanedNonces {
		if string(res.Orphaned[i].ActionNonce) != n {
			t.Errorf("orphaned[%d]: want %s, got %s", i, n, res.Orphaned[i].ActionNonce)
		}
	}
	if len(res.State.Players) != v.ExpectedPlayerCount {
		t.Errorf("player count: want %d, got %d", v.ExpectedPlayerCount, len(res.State.Players))
	}
}

func TestVector_FeeHandling(t *testing.T) {
	var v struct {
		Cases []struct {
			BetAmount     int64  `json:"bet_amount"`
			ExpectedError string `json:"expected_error"`
		} `json:"cases"`
	}
	loadVector(t, "fee-handling.json", &v)

	s := betDecisionState(106)
	for _, c := range v.Cases {
		bet := types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionBet, ActionNonce: "bet",
			ActingPlayerSeat: seatPtr(0), BetAmount: types.Satoshis(c.BetAmount),
		}
		_, err := engine.ApplyAction(s, bet, ruleSet(), types.BlockHeight(100))
		if err == nil || string(err.Code) != c.ExpectedError {
			t.Errorf("bet %d: want %s, got %v", c.BetAmount, c.ExpectedError, err)
		}
	}
}

func TestVector_DuplicateIdempotency(t *testing.T) {
	var v struct {
		GameId string `json:"game_id"`
		Action struct {
			ActionNonce      string `json:"action_nonce"`
			ActingPlayerSeat int    `json:"acting_player_seat"`
			PlayerPubkey     string `json:"player_pubkey"`
			StakeAmount      int64  `json:"stake_amount"`
		} `json:"action"`
		ExpectedDuplicateError string `json:"expected_duplicate_error"`
	}
	loadVector(t, "duplicate-idempotency.json", &v)

	sess := newSession()
	join := types.SignedAction{
		GameId: types.GameId(v.GameId), ActionType: types.ActionJoin, ActionNonce: types.ActionNonce(v.Action.ActionNonce),
		ActingPlayerSeat: seatPtr(v.Action.ActingPlayerSeat), PlayerPubkey: types.Pubkey33(v.Action.PlayerPubkey), StakeAmount: types.Satoshis(v.Action.StakeAmount),
	}
	if _, err := sess.Submit(join, 100); err != nil {
		t.Fatalf("first submit rejected: %v", err)
	}
	_, err := sess.Submit(join, 100)
	if err == nil || string(err.Code) != v.ExpectedDuplicateError {
		t.Errorf("duplicate: want %s, got %v", v.ExpectedDuplicateError, err)
	}
}
