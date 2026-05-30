package cryptocards

import (
	"encoding/hex"
	"testing"
)

// Canonical hex values pinned by the cross-language conformance run.
// The TypeScript reference at packages/crypto-cards asserts the same
// strings; both implementations MUST agree on every constant below.
// If either side disagrees, the protocol has diverged and CI fails.
const (
	expectedFirstShuffledOrdinal = 6
	expectedCommitmentSeat0      = "3df87bf0050b68c9991f0f297a393f3bd1c60b9fd14f46759472798b03879f56"
	expectedCombinedEntropy      = "d51fb438af0eff4de957ccf3c3378c712228d937939c74251c5bcae0760ab380"
	expectedDeckCommitmentHash   = "13b01e0dcbbaa3e886171f0a0f006b9fcaabab6197660270523e73900fb45328"
)

// TestCrossLanguageConformance pins the byte-level outputs of the
// reference Go implementation against the TypeScript reference at
// packages/crypto-cards. When both languages agree on every constant
// above, the mental-poker MVP is conformance-bound.
func TestCrossLanguageConformance(t *testing.T) {
	v := loadVector(t)

	entropies := make([][]byte, len(v.Inputs.Players))
	for i, p := range v.Inputs.Players {
		entropies[i] = mustHex(t, p.EntropyHex)
	}
	gameId := mustHex(t, v.Inputs.GameIdHex)

	gotCommitSeat0 := commitHex(t, entropies[0], mustHex(t, v.Inputs.Players[0].PlayerIdHex), gameId)
	if gotCommitSeat0 != expectedCommitmentSeat0 {
		t.Errorf("commitment_seat_0:\n  want %s\n  got  %s", expectedCommitmentSeat0, gotCommitSeat0)
	}

	combined, err := CombineEntropy(entropies)
	if err != nil {
		t.Fatalf("CombineEntropy: %v", err)
	}
	gotCombined := hex.EncodeToString(combined)
	if gotCombined != expectedCombinedEntropy {
		t.Errorf("combined_entropy:\n  want %s\n  got  %s", expectedCombinedEntropy, gotCombined)
	}

	dc, err := BuildDeckCommitment(combined, v.Inputs.DeckSize, v.Inputs.ShuffleAlgorithmVersion)
	if err != nil {
		t.Fatalf("BuildDeckCommitment: %v", err)
	}
	gotDeckHash := hex.EncodeToString(dc.DeckCommitmentHash)
	if gotDeckHash != expectedDeckCommitmentHash {
		t.Errorf("deck_commitment_hash:\n  want %s\n  got  %s", expectedDeckCommitmentHash, gotDeckHash)
	}

	if dc.ShuffledDeck[0] != expectedFirstShuffledOrdinal {
		t.Errorf("first_shuffled_ordinal: want %d, got %d", expectedFirstShuffledOrdinal, dc.ShuffledDeck[0])
	}
}

func commitHex(t *testing.T, entropy, playerId, gameId []byte) string {
	t.Helper()
	c, err := CommitEntropy(entropy, playerId, gameId)
	if err != nil {
		t.Fatalf("CommitEntropy: %v", err)
	}
	return hex.EncodeToString(c)
}
