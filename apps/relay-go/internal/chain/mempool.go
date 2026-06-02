package chain

import "github.com/prof-faustus/cardtable/relay-go/pkg/types"

// DefaultRebroadcastMax is `relay_rebroadcast_max` from
// spec/ordering-rules.md §4 — the number of rebroadcast attempts the
// relay makes before surfacing a recovery recommendation.
const DefaultRebroadcastMax = 3

// TxStatus is the relay's latest view of a previously-relayed
// transaction, as reported by the chain client / mempool poll.
type TxStatus int

const (
	// StatusInMempool: the tx is sitting unconfirmed in the mempool.
	StatusInMempool TxStatus = iota
	// StatusConfirmed: the tx has been mined into a block.
	StatusConfirmed
	// StatusNotInMempool: the tx is neither confirmed nor in the
	// mempool — i.e. it was evicted (or dropped before acceptance).
	StatusNotInMempool
)

// EventKind is the action the tracker tells the relay to take.
type EventKind int

const (
	// EventNone: nothing to do.
	EventNone EventKind = iota
	// EventRebroadcast: re-send the tx from the persistent store
	// (spec/ordering-rules.md §4 step 2).
	EventRebroadcast
	// EventRecoveryRecommended: rebroadcast attempts are exhausted;
	// surface a RECOVERY_RECOMMENDED event (§4 step 3).
	EventRecoveryRecommended
)

func (k EventKind) String() string {
	switch k {
	case EventRebroadcast:
		return "REBROADCAST"
	case EventRecoveryRecommended:
		return "RECOVERY_RECOMMENDED"
	default:
		return "NONE"
	}
}

// Event is what Observe returns for one status report.
type Event struct {
	Kind EventKind
	TxId types.TxId
	// Attempt is the 1-based rebroadcast attempt number, set only when
	// Kind == EventRebroadcast.
	Attempt int
}

type tracked struct {
	confirmed    bool
	rebroadcasts int
	exhausted    bool
}

// Tracker implements the relay's mempool-eviction rebroadcast policy
// of spec/ordering-rules.md §4: track relayed unconfirmed txs, detect
// eviction, rebroadcast from the store, and after `max` attempts
// surface a recovery recommendation. Intended to be driven from the
// relay's single-threaded poll loop.
type Tracker struct {
	max int
	txs map[types.TxId]*tracked
}

// NewTracker returns a Tracker allowing `max` rebroadcast attempts per
// transaction. A non-positive max falls back to DefaultRebroadcastMax.
func NewTracker(max int) *Tracker {
	if max <= 0 {
		max = DefaultRebroadcastMax
	}
	return &Tracker{max: max, txs: map[types.TxId]*tracked{}}
}

// Relay records that the relay has broadcast `txid` into the mempool
// (spec/ordering-rules.md §4 step 1). Idempotent.
func (t *Tracker) Relay(txid types.TxId) {
	if _, ok := t.txs[txid]; !ok {
		t.txs[txid] = &tracked{}
	}
}

// Observe feeds the latest status of a tracked tx and returns the
// action the relay should take. Calls for an untracked txid are no-ops
// (EventNone): the relay only manages transactions it originated.
func (t *Tracker) Observe(txid types.TxId, status TxStatus) Event {
	tr, ok := t.txs[txid]
	if !ok {
		return Event{Kind: EventNone, TxId: txid}
	}

	switch status {
	case StatusConfirmed:
		tr.confirmed = true
		return Event{Kind: EventNone, TxId: txid}

	case StatusInMempool:
		// Still pending; nothing to do.
		return Event{Kind: EventNone, TxId: txid}

	case StatusNotInMempool:
		// A confirmed tx that later leaves the mempool is normal (it
		// is in a block now); an exhausted one has already escalated.
		if tr.confirmed || tr.exhausted {
			return Event{Kind: EventNone, TxId: txid}
		}
		if tr.rebroadcasts >= t.max {
			tr.exhausted = true
			return Event{Kind: EventRecoveryRecommended, TxId: txid}
		}
		tr.rebroadcasts++
		return Event{Kind: EventRebroadcast, TxId: txid, Attempt: tr.rebroadcasts}
	}

	return Event{Kind: EventNone, TxId: txid}
}

// Rebroadcasts reports how many rebroadcast attempts have been made
// for `txid` (0 if untracked). Exposed for the relay's metrics.
func (t *Tracker) Rebroadcasts(txid types.TxId) int {
	if tr, ok := t.txs[txid]; ok {
		return tr.rebroadcasts
	}
	return 0
}
