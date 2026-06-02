package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/internal/chain"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 12: Mempool eviction → rebroadcast and recovery. Drives the
// relay's eviction-tracker policy (spec/ordering-rules.md §4) end to end:
// a relayed tx is evicted, rebroadcast up to the limit, then escalates to
// a recovery recommendation.
func TestScenario12_MempoolEvictionRebroadcastThenRecovery(t *testing.T) {
	tr := chain.NewTracker(2) // allow 2 rebroadcasts before escalating
	txid := types.TxId("ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11ee11")
	tr.Relay(txid)

	// First eviction → rebroadcast attempt 1.
	if e := tr.Observe(txid, chain.StatusNotInMempool); e.Kind != chain.EventRebroadcast || e.Attempt != 1 {
		t.Fatalf("scenario 12: first eviction want REBROADCAST#1, got %s#%d", e.Kind, e.Attempt)
	}
	// Re-accepted into mempool → nothing to do.
	if e := tr.Observe(txid, chain.StatusInMempool); e.Kind != chain.EventNone {
		t.Fatalf("scenario 12: in-mempool want NONE, got %s", e.Kind)
	}
	// Evicted again → rebroadcast attempt 2.
	if e := tr.Observe(txid, chain.StatusNotInMempool); e.Kind != chain.EventRebroadcast || e.Attempt != 2 {
		t.Fatalf("scenario 12: second eviction want REBROADCAST#2, got %s#%d", e.Kind, e.Attempt)
	}
	// Evicted a third time → attempts exhausted → recovery recommended.
	if e := tr.Observe(txid, chain.StatusNotInMempool); e.Kind != chain.EventRecoveryRecommended {
		t.Fatalf("scenario 12: exhausted want RECOVERY_RECOMMENDED, got %s", e.Kind)
	}
	// Subsequent reports are idempotent no-ops.
	if e := tr.Observe(txid, chain.StatusNotInMempool); e.Kind != chain.EventNone {
		t.Errorf("scenario 12: post-escalation want NONE, got %s", e.Kind)
	}
}

// Scenario 12 (part 2): a confirmed tx that later leaves the mempool is
// normal (it is in a block) and must NOT be rebroadcast.
func TestScenario12_ConfirmedTxNotRebroadcast(t *testing.T) {
	tr := chain.NewTracker(3)
	txid := types.TxId("c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0")
	tr.Relay(txid)
	if e := tr.Observe(txid, chain.StatusConfirmed); e.Kind != chain.EventNone {
		t.Fatalf("confirmed want NONE, got %s", e.Kind)
	}
	if e := tr.Observe(txid, chain.StatusNotInMempool); e.Kind != chain.EventNone {
		t.Errorf("scenario 12: confirmed-then-gone want NONE (in block), got %s", e.Kind)
	}
}

// Scenario 12 (part 3): rebroadcast is idempotent at the session layer —
// re-submitting the same accepted action after eviction does not
// double-apply (STALE_STATE), so recovery from eviction never corrupts
// the canonical transcript.
func TestScenario12_RebroadcastIsSessionIdempotent(t *testing.T) {
	sess := newSession()
	join := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: "rb",
		ActingPlayerSeat: seatPtr(0), PlayerPubkey: types.Pubkey33(pubkeys[0]), StakeAmount: 1000,
	}
	if _, err := sess.Submit(join, 100); err != nil {
		t.Fatalf("initial broadcast rejected: %v", err)
	}
	players := len(sess.State().Players)
	// Rebroadcast after a simulated eviction: same nonce again.
	if _, err := sess.Submit(join, 101); err == nil || err.Code != types.ErrStaleState {
		t.Errorf("scenario 12: rebroadcast want STALE_STATE, got %v", err)
	}
	if got := len(sess.State().Players); got != players {
		t.Errorf("scenario 12: rebroadcast double-applied (%d -> %d)", players, got)
	}
}
