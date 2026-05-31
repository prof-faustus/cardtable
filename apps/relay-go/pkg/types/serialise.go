// Canonical state-hash computation per spec/serialisation.md §5.
//
//	stateHash = SHA-256( type_tag(0x0009) || canonical_encoding(state) )
//
// with state.state_hash itself encoded as 32 zero bytes inside the
// hashed input. The TypeScript reference at
// packages/protocol-types/src/serialise.ts MUST produce byte-identical
// output for byte-identical inputs — the cross-language vector at
// spec/test-vectors/state-hash.json is the binding surface.

package types

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"sort"
)

const (
	tagPlayer       uint16 = 0x0002
	tagRoundState   uint16 = 0x0009
	playerVersion   uint8  = 1
	roundStateVersion uint8 = 1
)

var zero32 = make([]byte, 32)

// ---------------------------------------------------------------------------
// Primitive encoders
// ---------------------------------------------------------------------------

func encU8(n uint8) []byte { return []byte{n} }

func encU16LE(n uint16) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, n)
	return b
}

func encU32LE(n uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, n)
	return b
}

func encU64LE(n uint64) []byte {
	b := make([]byte, 8)
	binary.LittleEndian.PutUint64(b, n)
	return b
}

func encBool(b bool) []byte {
	if b {
		return []byte{1}
	}
	return []byte{0}
}

func encVarint(n uint64) []byte {
	switch {
	case n < 0xfd:
		return []byte{byte(n)}
	case n <= 0xffff:
		out := make([]byte, 3)
		out[0] = 0xfd
		binary.LittleEndian.PutUint16(out[1:], uint16(n))
		return out
	case n <= 0xffffffff:
		out := make([]byte, 5)
		out[0] = 0xfe
		binary.LittleEndian.PutUint32(out[1:], uint32(n))
		return out
	default:
		out := make([]byte, 9)
		out[0] = 0xff
		binary.LittleEndian.PutUint64(out[1:], n)
		return out
	}
}

func encString(s string) []byte {
	bytes := []byte(s)
	return concat(encVarint(uint64(len(bytes))), bytes)
}

func encBytes32Hex(h string) ([]byte, error) {
	if len(h) != 64 {
		return nil, fmt.Errorf("encBytes32Hex: expected 64 hex chars, got %d (%q)", len(h), h)
	}
	out, err := hex.DecodeString(h)
	if err != nil {
		return nil, fmt.Errorf("encBytes32Hex: %w", err)
	}
	return out, nil
}

func encOptionalHash(h Hash256) ([]byte, error) {
	if h == "" {
		return encBool(false), nil
	}
	body, err := encBytes32Hex(string(h))
	if err != nil {
		return nil, err
	}
	return concat(encBool(true), body), nil
}

func encOptionalU32Ptr(n *BlockHeight) []byte {
	if n == nil {
		return encBool(false)
	}
	return concat(encBool(true), encU32LE(uint32(*n)))
}

func encOptionalSeatPtr(n *Seat) []byte {
	if n == nil {
		return encBool(false)
	}
	return concat(encBool(true), encU32LE(uint32(*n)))
}

func encOptionalString(s string) []byte {
	if s == "" {
		return encBool(false)
	}
	return concat(encBool(true), encString(s))
}

func encArrayBytes32(items []Hash256) ([]byte, error) {
	parts := [][]byte{encVarint(uint64(len(items)))}
	for _, h := range items {
		b, err := encBytes32Hex(string(h))
		if err != nil {
			return nil, err
		}
		parts = append(parts, b)
	}
	return concat(parts...), nil
}

func encArrayString(items []ActionType) []byte {
	parts := [][]byte{encVarint(uint64(len(items)))}
	for _, s := range items {
		parts = append(parts, encString(string(s)))
	}
	return concat(parts...)
}

func encArrayStringOutpoint(items []Outpoint) []byte {
	parts := [][]byte{encVarint(uint64(len(items)))}
	for _, s := range items {
		parts = append(parts, encString(string(s)))
	}
	return concat(parts...)
}

func encPreferences(prefs map[string]string) []byte {
	keys := make([]string, 0, len(prefs))
	for k := range prefs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := [][]byte{encVarint(uint64(len(keys)))}
	for _, k := range keys {
		parts = append(parts, encString(k))
		parts = append(parts, encString(prefs[k]))
	}
	return concat(parts...)
}

func concat(parts ...[]byte) []byte {
	total := 0
	for _, p := range parts {
		total += len(p)
	}
	out := make([]byte, 0, total)
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// ---------------------------------------------------------------------------
// Composite encoders
// ---------------------------------------------------------------------------

func encPlayer(p PlayerState) ([]byte, error) {
	playerId, err := encBytes32Hex(string(p.PlayerId))
	if err != nil {
		return nil, fmt.Errorf("encPlayer: player_id: %w", err)
	}
	// Tail-32-of-pubkey, mirroring the TS encoder.
	pkHex := string(p.ValueSigningPubkey)
	if len(pkHex) < 64 {
		return nil, fmt.Errorf("encPlayer: pubkey shorter than 32 bytes hex: %q", pkHex)
	}
	pubkeyTail, err := encBytes32Hex(pkHex[len(pkHex)-64:])
	if err != nil {
		return nil, fmt.Errorf("encPlayer: pubkey tail: %w", err)
	}
	commitOpt, err := encOptionalHash(p.EntropyCommitmentHash)
	if err != nil {
		return nil, fmt.Errorf("encPlayer: entropy_commitment_hash: %w", err)
	}
	entropyOpt, err := encOptionalHash(p.EntropyValue)
	if err != nil {
		return nil, fmt.Errorf("encPlayer: entropy_value: %w", err)
	}
	return concat(
		encU16LE(tagPlayer),
		encU8(playerVersion),
		encU32LE(uint32(p.Seat)),
		playerId,
		pubkeyTail,
		encString(string(p.ParticipationStatus)),
		encU64LE(uint64(p.StakeAtRisk)),
		encOptionalString(string(p.StakeOutpoint)),
		encBool(p.EntropyCommitted),
		commitOpt,
		encBool(p.EntropyRevealed),
		entropyOpt,
		encArrayStringOutpoint(p.ConcealedCardRefs),
		encPreferences(p.DefaultPreferences),
	), nil
}

func encVisibleCards(cards []RevealedCard) []byte {
	parts := [][]byte{encVarint(uint64(len(cards)))}
	for _, c := range cards {
		parts = append(parts, encU8(uint8(c.Ordinal)))
	}
	return concat(parts...)
}

// EncodeRoundState returns the canonical encoding of a RoundState, with
// the state_hash field replaced by 32 zero bytes (self-reference is
// not part of the hashed input).
func EncodeRoundState(s RoundState) ([]byte, error) {
	playersParts := [][]byte{encVarint(uint64(len(s.Players)))}
	for _, p := range s.Players {
		enc, err := encPlayer(p)
		if err != nil {
			return nil, err
		}
		playersParts = append(playersParts, enc)
	}
	gameId, err := encBytes32Hex(string(s.GameId))
	if err != nil {
		return nil, fmt.Errorf("EncodeRoundState: game_id: %w", err)
	}
	ruleHash, err := encBytes32Hex(string(s.RuleSetHash))
	if err != nil {
		return nil, fmt.Errorf("EncodeRoundState: rule_set_hash: %w", err)
	}
	hiddenRefs, err := encArrayBytes32(s.HiddenCommitmentRefs)
	if err != nil {
		return nil, fmt.Errorf("EncodeRoundState: hidden_commitment_refs: %w", err)
	}
	successorRefs, err := encArrayBytes32(s.SuccessorTemplateHashes)
	if err != nil {
		return nil, fmt.Errorf("EncodeRoundState: successor_template_hashes: %w", err)
	}
	combinedOpt, err := encOptionalHash(s.CombinedEntropy)
	if err != nil {
		return nil, fmt.Errorf("EncodeRoundState: combined_entropy: %w", err)
	}
	deckOpt, err := encOptionalHash(s.DeckCommitmentHash)
	if err != nil {
		return nil, fmt.Errorf("EncodeRoundState: deck_commitment_hash: %w", err)
	}
	var priorOpt []byte
	if s.PriorStateHash != nil {
		priorOpt, err = encOptionalHash(*s.PriorStateHash)
		if err != nil {
			return nil, fmt.Errorf("EncodeRoundState: prior_state_hash: %w", err)
		}
	} else {
		priorOpt = encBool(false)
	}

	return concat(
		encU16LE(tagRoundState),
		encU8(roundStateVersion),
		encString(string(s.StateClass)),
		gameId,
		ruleHash,
		encU32LE(uint32(s.RoundNumber)),
		encOptionalSeatPtr(s.ActingPlayerSeat),
		concat(playersParts...),
		encU64LE(uint64(s.PotValue)),
		encVisibleCards(s.VisibleCards),
		hiddenRefs,
		encArrayString(s.AllowedActions),
		encOptionalU32Ptr(s.DecisionDeadlineBlockHeight),
		encOptionalU32Ptr(s.RecoveryDeadlineBlockHeight),
		successorRefs,
		combinedOpt,
		deckOpt,
		priorOpt,
		zero32,
	), nil
}

// ComputeStateHash returns the canonical state hash as a 64-char hex
// string.
func ComputeStateHash(s RoundState) (Hash256, error) {
	encoded, err := EncodeRoundState(s)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(encoded)
	return Hash256(hex.EncodeToString(h[:])), nil
}

// ChainsFromHash reports whether `next.prior_state_hash` equals
// ComputeStateHash(prior). The initial state of a session chains from
// nil.
func ChainsFromHash(prior *RoundState, next RoundState) (bool, error) {
	if prior == nil {
		return next.PriorStateHash == nil, nil
	}
	if next.PriorStateHash == nil {
		return false, nil
	}
	expected, err := ComputeStateHash(*prior)
	if err != nil {
		return false, err
	}
	return *next.PriorStateHash == expected, nil
}
