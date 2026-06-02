package chain

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Phase 6 on-chain adversarial scenario: MEMPOOL EVICTION.
//
// A transaction the relay broadcast is dropped from the mempool before
// it confirms (fee pressure, eviction, a conflicting spend). Per
// spec/ordering-rules.md §4 the relay must rebroadcast from its store,
// and after `relay_rebroadcast_max` (default 3) attempts surface a
// RECOVERY_RECOMMENDED event. These tests pin that policy.

const txA = types.TxId("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

func TestMempool_DefaultMaxIsThree(t *testing.T) {
	tr := NewTracker(0) // 0 -> default
	tr.Relay(txA)

	// Three successive evictions each trigger a rebroadcast.
	for i := 1; i <= DefaultRebroadcastMax; i++ {
		ev := tr.Observe(txA, StatusNotInMempool)
		if ev.Kind != EventRebroadcast {
			t.Fatalf("eviction %d: want REBROADCAST, got %s", i, ev.Kind)
		}
		if ev.Attempt != i {
			t.Errorf("eviction %d: want attempt %d, got %d", i, i, ev.Attempt)
		}
	}

	// The fourth eviction, with attempts exhausted, escalates.
	ev := tr.Observe(txA, StatusNotInMempool)
	if ev.Kind != EventRecoveryRecommended {
		t.Fatalf("after %d rebroadcasts want RECOVERY_RECOMMENDED, got %s", DefaultRebroadcastMax, ev.Kind)
	}

	// Further evictions stay quiet — recovery is already recommended.
	if ev := tr.Observe(txA, StatusNotInMempool); ev.Kind != EventNone {
		t.Errorf("post-escalation eviction must be EventNone, got %s", ev.Kind)
	}
}

// TestMempool_ConfirmationStopsRebroadcast proves that once a tx
// confirms, a later mempool absence (it is in a block now, not the
// mempool) does not trigger a rebroadcast.
func TestMempool_ConfirmationStopsRebroadcast(t *testing.T) {
	tr := NewTracker(3)
	tr.Relay(txA)

	// One eviction, one rebroadcast.
	if ev := tr.Observe(txA, StatusNotInMempool); ev.Kind != EventRebroadcast {
		t.Fatalf("want REBROADCAST, got %s", ev.Kind)
	}
	// Then it confirms.
	if ev := tr.Observe(txA, StatusConfirmed); ev.Kind != EventNone {
		t.Fatalf("confirmation must be EventNone, got %s", ev.Kind)
	}
	// Leaving the mempool after confirmation is expected, not an
	// eviction to rebroadcast.
	if ev := tr.Observe(txA, StatusNotInMempool); ev.Kind != EventNone {
		t.Errorf("post-confirmation mempool absence must be EventNone, got %s", ev.Kind)
	}
	if got := tr.Rebroadcasts(txA); got != 1 {
		t.Errorf("want exactly 1 rebroadcast recorded, got %d", got)
	}
}

// TestMempool_InMempoolIsQuiet verifies a tx still pending in the
// mempool produces no event.
func TestMempool_InMempoolIsQuiet(t *testing.T) {
	tr := NewTracker(3)
	tr.Relay(txA)
	if ev := tr.Observe(txA, StatusInMempool); ev.Kind != EventNone {
		t.Errorf("in-mempool must be EventNone, got %s", ev.Kind)
	}
}

// TestMempool_UntrackedTxIsIgnored proves the relay only acts on
// transactions it originated.
func TestMempool_UntrackedTxIsIgnored(t *testing.T) {
	tr := NewTracker(3)
	if ev := tr.Observe(txA, StatusNotInMempool); ev.Kind != EventNone {
		t.Errorf("untracked tx must be EventNone, got %s", ev.Kind)
	}
}

// TestMempool_CustomMaxRespected checks a non-default ceiling.
func TestMempool_CustomMaxRespected(t *testing.T) {
	tr := NewTracker(1)
	tr.Relay(txA)
	if ev := tr.Observe(txA, StatusNotInMempool); ev.Kind != EventRebroadcast {
		t.Fatalf("attempt 1 want REBROADCAST, got %s", ev.Kind)
	}
	if ev := tr.Observe(txA, StatusNotInMempool); ev.Kind != EventRecoveryRecommended {
		t.Fatalf("with max=1, second eviction want RECOVERY_RECOMMENDED, got %s", ev.Kind)
	}
}
