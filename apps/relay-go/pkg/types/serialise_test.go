package types

import (
	"encoding/hex"
	"testing"
)

// Reference state used for cross-language conformance with the TS
// equivalent at packages/protocol-types/__tests__/state-hash.test.ts.
func referenceState() RoundState {
	return RoundState{
		StateClass:                  StateSeatOpen,
		GameId:                      GameId(repeatHex(0xaa)),
		RuleSetHash:                 RuleSetHash(repeatHex(0xbb)),
		RoundNumber:                 0,
		ActingPlayerSeat:            nil,
		Players:                     []PlayerState{},
		PotValue:                    0,
		VisibleCards:                []RevealedCard{},
		HiddenCommitmentRefs:        []Hash256{},
		AllowedActions:              []ActionType{ActionJoin, ActionTableLock},
		DecisionDeadlineBlockHeight: nil,
		RecoveryDeadlineBlockHeight: heightPtr(244),
		SuccessorTemplateHashes:     []Hash256{},
		CombinedEntropy:             "",
		DeckCommitmentHash:          "",
		PriorStateHash:              nil,
		StateHash:                   Hash256(repeatHex(0x00)),
	}
}

func repeatHex(b byte) string {
	out := make([]byte, 32)
	for i := range out {
		out[i] = b
	}
	return hex.EncodeToString(out)
}

func heightPtr(h uint32) *BlockHeight {
	v := BlockHeight(h)
	return &v
}

func TestComputeStateHashDeterministic(t *testing.T) {
	s := referenceState()
	a, err := ComputeStateHash(s)
	if err != nil {
		t.Fatalf("ComputeStateHash: %v", err)
	}
	b, err := ComputeStateHash(s)
	if err != nil {
		t.Fatalf("ComputeStateHash(again): %v", err)
	}
	if a != b {
		t.Errorf("non-deterministic state hash: %s vs %s", a, b)
	}
	if len(a) != 64 {
		t.Errorf("state hash length: want 64, got %d", len(a))
	}
}

func TestComputeStateHashIgnoresSelfReference(t *testing.T) {
	a := referenceState()
	a.StateHash = Hash256(repeatHex(0x00))
	b := referenceState()
	b.StateHash = Hash256(repeatHex(0xff))
	ha, err := ComputeStateHash(a)
	if err != nil {
		t.Fatalf("hash a: %v", err)
	}
	hb, err := ComputeStateHash(b)
	if err != nil {
		t.Fatalf("hash b: %v", err)
	}
	if ha != hb {
		t.Errorf("state_hash field leaked into the hash: %s vs %s", ha, hb)
	}
}

func TestChainsFromHash(t *testing.T) {
	parent := referenceState()
	parentHash, err := ComputeStateHash(parent)
	if err != nil {
		t.Fatalf("parent hash: %v", err)
	}
	child := referenceState()
	child.RoundNumber = 1
	child.PriorStateHash = &parentHash
	ok, err := ChainsFromHash(&parent, child)
	if err != nil {
		t.Fatalf("chainsFromHash: %v", err)
	}
	if !ok {
		t.Error("honest child does not chain")
	}
	bogus := Hash256(repeatHex(0xcc))
	child.PriorStateHash = &bogus
	ok, err = ChainsFromHash(&parent, child)
	if err != nil {
		t.Fatalf("chainsFromHash(bogus): %v", err)
	}
	if ok {
		t.Error("bogus prior_state_hash should not chain")
	}
}

// TestCrossLanguageStateHashSeatOpen pins the Go state hash for the
// reference empty S1_SEAT_OPEN state. The TypeScript reference at
// packages/protocol-types/__tests__/state-hash.test.ts asserts the
// same constant. Any change MUST be matched in both languages.
func TestCrossLanguageStateHashSeatOpen(t *testing.T) {
	const expected = "71ebf03120b9316b599055eee1c7742233de9ac1be4867ce5acd411699aa68dd"
	s := referenceState()
	h, err := ComputeStateHash(s)
	if err != nil {
		t.Fatalf("ComputeStateHash: %v", err)
	}
	if string(h) != expected {
		t.Errorf("state_hash_s1_seat_open:\n  want %s\n  got  %s", expected, h)
	}
}
