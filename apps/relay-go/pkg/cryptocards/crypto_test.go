package cryptocards

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

type vectorPlayer struct {
	Seat        int    `json:"seat"`
	PlayerIdHex string `json:"player_id_hex"`
	EntropyHex  string `json:"entropy_hex"`
}

type vectorFile struct {
	Inputs struct {
		GameIdHex               string         `json:"game_id_hex"`
		DeckSize                int            `json:"deck_size"`
		ShuffleAlgorithmVersion int            `json:"shuffle_algorithm_version"`
		Players                 []vectorPlayer `json:"players"`
		RevealPosition          int            `json:"reveal_position"`
	} `json:"inputs"`
}

func loadVector(t *testing.T) vectorFile {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// pkg/cryptocards -> repo root is 4 hops: pkg/cryptocards ->
	// pkg -> relay-go -> apps -> root.
	path := filepath.Join(wd, "..", "..", "..", "..", "spec", "test-vectors", "mental-poker.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read vector %q: %v", path, err)
	}
	var v vectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("parse vector: %v", err)
	}
	return v
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("hex.DecodeString(%q): %v", s, err)
	}
	return b
}

func TestCommitEntropyRoundtrip(t *testing.T) {
	v := loadVector(t)
	p := v.Inputs.Players[0]
	entropy := mustHex(t, p.EntropyHex)
	playerId := mustHex(t, p.PlayerIdHex)
	gameId := mustHex(t, v.Inputs.GameIdHex)

	first, err := CommitEntropy(entropy, playerId, gameId)
	if err != nil {
		t.Fatalf("CommitEntropy: %v", err)
	}
	second, err := CommitEntropy(entropy, playerId, gameId)
	if err != nil {
		t.Fatalf("CommitEntropy(again): %v", err)
	}
	if hex.EncodeToString(first) != hex.EncodeToString(second) {
		t.Errorf("CommitEntropy is non-deterministic")
	}
	if len(first) != 32 {
		t.Errorf("commitment length: want 32, got %d", len(first))
	}

	ok, err := VerifyEntropyReveal(first, entropy, playerId, gameId)
	if err != nil {
		t.Fatalf("VerifyEntropyReveal: %v", err)
	}
	if !ok {
		t.Error("VerifyEntropyReveal: want true, got false")
	}

	bad := append([]byte{}, entropy...)
	bad[0] ^= 0xff
	ok, err = VerifyEntropyReveal(first, bad, playerId, gameId)
	if err != nil {
		t.Fatalf("VerifyEntropyReveal(tampered): %v", err)
	}
	if ok {
		t.Error("VerifyEntropyReveal(tampered): want false, got true")
	}
}

func TestCombineEntropyDeterministicOrderSensitive(t *testing.T) {
	v := loadVector(t)
	entropies := make([][]byte, len(v.Inputs.Players))
	for i, p := range v.Inputs.Players {
		entropies[i] = mustHex(t, p.EntropyHex)
	}
	a, err := CombineEntropy(entropies)
	if err != nil {
		t.Fatalf("CombineEntropy: %v", err)
	}
	b, err := CombineEntropy(entropies)
	if err != nil {
		t.Fatalf("CombineEntropy(again): %v", err)
	}
	if hex.EncodeToString(a) != hex.EncodeToString(b) {
		t.Error("CombineEntropy is non-deterministic")
	}
	swapped := [][]byte{entropies[1], entropies[0], entropies[2]}
	c, err := CombineEntropy(swapped)
	if err != nil {
		t.Fatalf("CombineEntropy(swapped): %v", err)
	}
	if hex.EncodeToString(c) == hex.EncodeToString(a) {
		t.Error("CombineEntropy order-insensitive")
	}
}

func TestShuffleIsPermutationDeterministic(t *testing.T) {
	v := loadVector(t)
	entropies := make([][]byte, len(v.Inputs.Players))
	for i, p := range v.Inputs.Players {
		entropies[i] = mustHex(t, p.EntropyHex)
	}
	combined, err := CombineEntropy(entropies)
	if err != nil {
		t.Fatalf("CombineEntropy: %v", err)
	}
	a, err := ShuffleCanonicalDeck(combined, v.Inputs.DeckSize)
	if err != nil {
		t.Fatalf("Shuffle: %v", err)
	}
	b, err := ShuffleCanonicalDeck(combined, v.Inputs.DeckSize)
	if err != nil {
		t.Fatalf("Shuffle(again): %v", err)
	}
	if len(a) != len(b) {
		t.Fatalf("shuffle length differs: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Errorf("shuffle non-deterministic at %d: %d vs %d", i, a[i], b[i])
		}
	}
	sorted := append([]int{}, a...)
	sort.Ints(sorted)
	for i, x := range sorted {
		if x != i {
			t.Errorf("shuffle not a permutation: sorted[%d]=%d", i, x)
		}
	}
}

func TestDeckCommitmentAndRevealProofRoundtrip(t *testing.T) {
	v := loadVector(t)
	entropies := make([][]byte, len(v.Inputs.Players))
	for i, p := range v.Inputs.Players {
		entropies[i] = mustHex(t, p.EntropyHex)
	}
	combined, err := CombineEntropy(entropies)
	if err != nil {
		t.Fatalf("CombineEntropy: %v", err)
	}
	dc, err := BuildDeckCommitment(combined, v.Inputs.DeckSize, v.Inputs.ShuffleAlgorithmVersion)
	if err != nil {
		t.Fatalf("BuildDeckCommitment: %v", err)
	}
	honest := dc.PerPosition[v.Inputs.RevealPosition]
	ok, err := VerifyRevealProof(honest.Commitment, RevealProof{
		Position:  honest.Position,
		Ordinal:   honest.Ordinal,
		CardNonce: honest.CardNonce,
		DeckNonce: honest.DeckNonce,
	})
	if err != nil {
		t.Fatalf("VerifyRevealProof: %v", err)
	}
	if !ok {
		t.Error("VerifyRevealProof(honest): want true, got false")
	}
	ok, err = VerifyRevealProof(honest.Commitment, RevealProof{
		Position:  honest.Position,
		Ordinal:   (honest.Ordinal + 1) % 52,
		CardNonce: honest.CardNonce,
		DeckNonce: honest.DeckNonce,
	})
	if err != nil {
		t.Fatalf("VerifyRevealProof(forged): %v", err)
	}
	if ok {
		t.Error("VerifyRevealProof(forged): want false, got true")
	}
}

func TestDeckCommitmentHashBindsEntropy(t *testing.T) {
	v := loadVector(t)
	entropies := make([][]byte, len(v.Inputs.Players))
	for i, p := range v.Inputs.Players {
		entropies[i] = mustHex(t, p.EntropyHex)
	}
	combinedA, _ := CombineEntropy(entropies)
	dcA, _ := BuildDeckCommitment(combinedA, 52, 1)

	flipped := append([]byte{}, entropies[0]...)
	flipped[0] ^= 0xff
	combinedB, _ := CombineEntropy([][]byte{flipped, entropies[1], entropies[2]})
	dcB, _ := BuildDeckCommitment(combinedB, 52, 1)

	if hex.EncodeToString(dcA.DeckCommitmentHash) == hex.EncodeToString(dcB.DeckCommitmentHash) {
		t.Error("deck commitment hash insensitive to entropy")
	}
}
