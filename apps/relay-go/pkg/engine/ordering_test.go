package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Phase 6 on-chain adversarial scenario: DOUBLE-SPEND.
//
// Two distinct transactions reference the same state output's same
// branch (e.g. two BetAction for one S8 state). spec/ordering-rules.md
// §3.1 defines a deterministic winner so every honest observer
// converges on the same canonical transaction. These tests are the
// conformance surface named in §6.1 ("for every test vector at
// spec/test-vectors/double-spend-attempt.json it selects the same
// winner the vector specifies") plus the confirmed/quorum precedence
// variants the vector's `notes` invite.

type doubleSpendCandidate struct {
	CandidateID      string `json:"candidate_id"`
	TxidHint         string `json:"txid_hint"`
	ObservedByQuorum bool   `json:"observed_by_quorum"`
	ConfirmedInBlock bool   `json:"confirmed_in_block"`
}

// doubleSpendVector mirrors the fields of
// spec/test-vectors/double-spend-attempt.json that drive the choice.
type doubleSpendVector struct {
	VectorID                  string                 `json:"vector_id"`
	CandidateActions          []doubleSpendCandidate `json:"candidate_actions"`
	ExpectedWinnerCandidateID string                 `json:"expected_winner_candidate_id"`
}

func (c doubleSpendCandidate) candidate() TxConflictCandidate {
	return TxConflictCandidate{
		TxId:             types.TxId(c.TxidHint),
		ObservedByQuorum: c.ObservedByQuorum,
		ConfirmedInBlock: c.ConfirmedInBlock,
	}
}

func loadDoubleSpendVector(t *testing.T) doubleSpendVector {
	t.Helper()
	// pkg/engine -> pkg -> relay-go -> apps -> <repo root>/spec/...
	path := filepath.Join("..", "..", "..", "..", "spec", "test-vectors", "double-spend-attempt.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read vector: %v", err)
	}
	var v doubleSpendVector
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("unmarshal vector: %v", err)
	}
	if len(v.CandidateActions) != 2 {
		t.Fatalf("vector must have exactly 2 candidates, got %d", len(v.CandidateActions))
	}
	return v
}

// allHex returns a 64-char txid all of the given hex nibble.
func allHex(nibble byte) types.TxId {
	return types.TxId(strings.Repeat(string(nibble), 64))
}

// TestDoubleSpend_VectorConformance loads the published vector and
// asserts PickConflictWinner selects exactly the candidate the vector
// names — spec/ordering-rules.md §6.1.
func TestDoubleSpend_VectorConformance(t *testing.T) {
	v := loadDoubleSpendVector(t)

	a := v.CandidateActions[0].candidate()
	b := v.CandidateActions[1].candidate()

	winner := PickConflictWinner(a, b)

	gotID := v.CandidateActions[0].CandidateID
	if winner.TxId == b.TxId {
		gotID = v.CandidateActions[1].CandidateID
	}
	if gotID != v.ExpectedWinnerCandidateID {
		t.Fatalf("vector %s: want winner %q, got %q (winner txid=%s)",
			v.VectorID, v.ExpectedWinnerCandidateID, gotID, winner.TxId)
	}

	// PickConflictWinner must be commutative: swapping the operands
	// must yield the same canonical winner. A non-commutative rule
	// would let two honest observers disagree.
	if PickConflictWinner(b, a).TxId != winner.TxId {
		t.Fatalf("vector %s: PickConflictWinner not commutative", v.VectorID)
	}
}

// TestDoubleSpend_ConfirmedBeatsTxidTiebreak is the variant the
// vector's `notes` field invites: candidate B is confirmed into a
// block, so §3.1 step 1 makes B win regardless of the txid tiebreak
// that would otherwise favour A.
func TestDoubleSpend_ConfirmedBeatsTxidTiebreak(t *testing.T) {
	a := TxConflictCandidate{TxId: allHex('a'), ConfirmedInBlock: false}
	b := TxConflictCandidate{TxId: allHex('b'), ConfirmedInBlock: true}

	if got := PickConflictWinner(a, b); got.TxId != b.TxId {
		t.Fatalf("confirmed B must win over unconfirmed A; got %s", got.TxId)
	}
	if got := PickConflictWinner(b, a); got.TxId != b.TxId {
		t.Fatalf("confirmed B must win regardless of operand order; got %s", got.TxId)
	}
}

// TestDoubleSpend_QuorumBeatsTxidTiebreak exercises §3.1 step 2: with
// neither confirmed, the quorum-observed candidate wins even though
// the txid tiebreak alone would pick the other one.
func TestDoubleSpend_QuorumBeatsTxidTiebreak(t *testing.T) {
	// A has the smaller txid (would win the tiebreak) but only B is
	// quorum-observed, so B must win.
	a := TxConflictCandidate{TxId: allHex('a'), ObservedByQuorum: false}
	b := TxConflictCandidate{TxId: allHex('b'), ObservedByQuorum: true}

	if got := PickConflictWinner(a, b); got.TxId != b.TxId {
		t.Fatalf("quorum-observed B must beat txid-smaller A; got %s", got.TxId)
	}
}

// TestDoubleSpend_ConfirmedBeatsQuorum exercises the precedence
// ordering itself: confirmation (step 1) outranks quorum (step 2).
func TestDoubleSpend_ConfirmedBeatsQuorum(t *testing.T) {
	a := TxConflictCandidate{TxId: allHex('a'), ConfirmedInBlock: true, ObservedByQuorum: false}
	b := TxConflictCandidate{TxId: allHex('b'), ConfirmedInBlock: false, ObservedByQuorum: true}

	if got := PickConflictWinner(a, b); got.TxId != a.TxId {
		t.Fatalf("confirmed A must beat merely-quorum B; got %s", got.TxId)
	}
}
