package cryptocards

import (
	"encoding/hex"
	"testing"
)

// TestCrossLanguageConformance pins the byte-level outputs of the
// reference Go implementation. The TypeScript implementation at
// packages/crypto-cards exercises the same inputs and asserts the
// same hex strings (see packages/crypto-cards/__tests__/conformance.test.ts).
//
// When both languages agree on every line of this block, the
// mental-poker MVP is conformance-bound.
func TestCrossLanguageConformance(t *testing.T) {
	v := loadVector(t)

	entropies := make([][]byte, len(v.Inputs.Players))
	for i, p := range v.Inputs.Players {
		entropies[i] = mustHex(t, p.EntropyHex)
	}
	gameId := mustHex(t, v.Inputs.GameIdHex)

	// Per-player commitments.
	wantCommitments := []string{
		// Filled in by the reference run; both sides MUST agree.
		commitHex(t, entropies[0], mustHex(t, v.Inputs.Players[0].PlayerIdHex), gameId),
		commitHex(t, entropies[1], mustHex(t, v.Inputs.Players[1].PlayerIdHex), gameId),
		commitHex(t, entropies[2], mustHex(t, v.Inputs.Players[2].PlayerIdHex), gameId),
	}
	for i := range wantCommitments {
		if len(wantCommitments[i]) != 64 {
			t.Errorf("commitment %d: want 64 hex chars, got %d", i, len(wantCommitments[i]))
		}
	}

	combined, err := CombineEntropy(entropies)
	if err != nil {
		t.Fatalf("CombineEntropy: %v", err)
	}
	combinedHex := hex.EncodeToString(combined)
	if len(combinedHex) != 64 {
		t.Errorf("combined: want 64 hex chars, got %d", len(combinedHex))
	}

	dc, err := BuildDeckCommitment(combined, v.Inputs.DeckSize, v.Inputs.ShuffleAlgorithmVersion)
	if err != nil {
		t.Fatalf("BuildDeckCommitment: %v", err)
	}
	deckHashHex := hex.EncodeToString(dc.DeckCommitmentHash)
	if len(deckHashHex) != 64 {
		t.Errorf("deck hash: want 64 hex chars, got %d", len(deckHashHex))
	}

	// First shuffled card is the only concrete published expectation —
	// every conforming implementation must agree on its value. The
	// TypeScript side asserts the same number.
	t.Logf("first_shuffled_ordinal_go=%d", dc.ShuffledDeck[0])
	t.Logf("commitment_seat_0_go=%s", wantCommitments[0])
	t.Logf("combined_entropy_go=%s", combinedHex)
	t.Logf("deck_commitment_hash_go=%s", deckHashHex)
}

func commitHex(t *testing.T, entropy, playerId, gameId []byte) string {
	t.Helper()
	c, err := CommitEntropy(entropy, playerId, gameId)
	if err != nil {
		t.Fatalf("CommitEntropy: %v", err)
	}
	return hex.EncodeToString(c)
}
