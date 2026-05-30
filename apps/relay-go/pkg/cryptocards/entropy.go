package cryptocards

import "fmt"

// CommitEntropy returns the entropy commitment hash:
//
//	H_EntropyCommitment( bytes32(entropy) || bytes32(playerId) || bytes32(gameId) )
func CommitEntropy(entropy, playerId, gameId []byte) ([]byte, error) {
	e, err := EncodeBytes32(entropy)
	if err != nil {
		return nil, fmt.Errorf("CommitEntropy: entropy: %w", err)
	}
	p, err := EncodeBytes32(playerId)
	if err != nil {
		return nil, fmt.Errorf("CommitEntropy: playerId: %w", err)
	}
	g, err := EncodeBytes32(gameId)
	if err != nil {
		return nil, fmt.Errorf("CommitEntropy: gameId: %w", err)
	}
	return DomainHash(TagEntropyCommitment, e, p, g), nil
}

// VerifyEntropyReveal returns true iff the revealed entropy hashes
// back to the commitment.
func VerifyEntropyReveal(commitment, entropy, playerId, gameId []byte) (bool, error) {
	recomputed, err := CommitEntropy(entropy, playerId, gameId)
	if err != nil {
		return false, err
	}
	return ConstantTimeEqual(recomputed, commitment), nil
}

// CombineEntropy is the deterministic seed derived from the ordered
// (seat-ascending) list of revealed entropies:
//
//	combined = H_DeckCommitment( encode_array(entropies) )
//
// where encode_array(...) is varint(count) || e_1 || ... || e_n.
func CombineEntropy(entropies [][]byte) ([]byte, error) {
	if len(entropies) == 0 {
		return nil, fmt.Errorf("CombineEntropy: empty list")
	}
	parts := make([][]byte, 0, len(entropies)+1)
	parts = append(parts, EncodeVarint(uint64(len(entropies))))
	for i, e := range entropies {
		ee, err := EncodeBytes32(e)
		if err != nil {
			return nil, fmt.Errorf("CombineEntropy: entropies[%d]: %w", i, err)
		}
		parts = append(parts, ee)
	}
	return DomainHash(TagDeckCommitment, parts...), nil
}
