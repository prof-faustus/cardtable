package cryptocards

import "fmt"

// CardCommitment is one position's committed-deck row.
type CardCommitment struct {
	Position   int
	Ordinal    int
	CardNonce  []byte // 32 bytes
	DeckNonce  []byte // 32 bytes
	Commitment []byte // 32 bytes
}

// DeckCommitment is the full committed-deck object — analogue of the
// TypeScript interface.
type DeckCommitment struct {
	CombinedEntropy         []byte
	ShuffleAlgorithmVersion int
	ShuffledDeck            []int
	PerPosition             []CardCommitment
	DeckCommitmentHash      []byte
}

// RevealProof is the public reveal-proof shape.
type RevealProof struct {
	Position  int
	Ordinal   int
	CardNonce []byte
	DeckNonce []byte
}

// deriveDeckNonce mirrors the TS impl: H( u16(TagDeckCommitment) ||
// combined || "deck-nonce" ).
func deriveDeckNonce(combined []byte) []byte {
	tag, _ := EncodeU16LE(int(TagDeckCommitment))
	return Sha256(Concat(tag, combined, []byte("deck-nonce")))
}

// deriveCardNonce mirrors the TS impl: H( u16(TagCard) || combined ||
// "card-nonce" || u32(position) ).
func deriveCardNonce(combined []byte, position int) []byte {
	tag, _ := EncodeU16LE(int(TagCard))
	return Sha256(Concat(tag, combined, []byte("card-nonce"), EncodeU32LE(uint32(position))))
}

// CommitCard returns H_Card( u8(ordinal) || bytes32(cardNonce) ||
// bytes32(deckNonce) ).
func CommitCard(ordinal int, cardNonce, deckNonce []byte) ([]byte, error) {
	if ordinal < 0 || ordinal > 53 {
		return nil, fmt.Errorf("CommitCard: ordinal out of 0..53 range: %d", ordinal)
	}
	ord, err := EncodeU8(ordinal)
	if err != nil {
		return nil, err
	}
	cn, err := EncodeBytes32(cardNonce)
	if err != nil {
		return nil, fmt.Errorf("CommitCard: cardNonce: %w", err)
	}
	dn, err := EncodeBytes32(deckNonce)
	if err != nil {
		return nil, fmt.Errorf("CommitCard: deckNonce: %w", err)
	}
	return DomainHash(TagCard, ord, cn, dn), nil
}

// BuildDeckCommitment constructs the full deck commitment for the
// given combined entropy. Pure: same input → same output.
func BuildDeckCommitment(combined []byte, deckSize int, shuffleAlgorithmVersion int) (*DeckCommitment, error) {
	if shuffleAlgorithmVersion != 1 {
		return nil, fmt.Errorf("BuildDeckCommitment: unsupported shuffle algorithm version %d", shuffleAlgorithmVersion)
	}
	shuffled, err := ShuffleCanonicalDeck(combined, deckSize)
	if err != nil {
		return nil, err
	}
	deckNonce := deriveDeckNonce(combined)
	per := make([]CardCommitment, 0, deckSize)
	for i, ordinal := range shuffled {
		cardNonce := deriveCardNonce(combined, i)
		commit, err := CommitCard(ordinal, cardNonce, deckNonce)
		if err != nil {
			return nil, fmt.Errorf("BuildDeckCommitment: position %d: %w", i, err)
		}
		per = append(per, CardCommitment{
			Position:   i,
			Ordinal:    ordinal,
			CardNonce:  cardNonce,
			DeckNonce:  deckNonce,
			Commitment: commit,
		})
	}
	aggParts := make([][]byte, 0, len(per)+1)
	algBytes, _ := EncodeU8(shuffleAlgorithmVersion)
	aggParts = append(aggParts, algBytes)
	for _, p := range per {
		aggParts = append(aggParts, p.Commitment)
	}
	hash := DomainHash(TagDeckCommitment, aggParts...)
	return &DeckCommitment{
		CombinedEntropy:         combined,
		ShuffleAlgorithmVersion: shuffleAlgorithmVersion,
		ShuffledDeck:            shuffled,
		PerPosition:             per,
		DeckCommitmentHash:      hash,
	}, nil
}

// VerifyRevealProof returns true iff the proof recomputes the expected
// commitment.
func VerifyRevealProof(expectedCommitment []byte, proof RevealProof) (bool, error) {
	recomputed, err := CommitCard(proof.Ordinal, proof.CardNonce, proof.DeckNonce)
	if err != nil {
		return false, err
	}
	return ConstantTimeEqual(recomputed, expectedCommitment), nil
}
