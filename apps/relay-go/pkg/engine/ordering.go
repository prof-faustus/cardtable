package engine

import "github.com/prof-faustus/cardtable/relay-go/pkg/types"

// TxConflictCandidate is one side of a conflict per spec/ordering-rules.md §3.1.
type TxConflictCandidate struct {
	TxId              types.TxId `json:"txid"`
	ObservedByQuorum  bool       `json:"observed_by_quorum"`
	ConfirmedInBlock  bool       `json:"confirmed_in_block"`
}

// PickConflictWinner picks the canonical winner between two conflicting
// transactions. Precedence per spec/ordering-rules.md §3.1:
//
//  1. one referenced by a confirmed BSV block wins,
//  2. one observed by the quorum wins,
//  3. lexicographically smaller txid wins.
func PickConflictWinner(a, b TxConflictCandidate) TxConflictCandidate {
	if a.ConfirmedInBlock && !b.ConfirmedInBlock {
		return a
	}
	if b.ConfirmedInBlock && !a.ConfirmedInBlock {
		return b
	}
	if a.ObservedByQuorum && !b.ObservedByQuorum {
		return a
	}
	if b.ObservedByQuorum && !a.ObservedByQuorum {
		return b
	}
	if a.TxId <= b.TxId {
		return a
	}
	return b
}
