package types

import (
	"fmt"
	"regexp"
)

// Branded-style primitive aliases. Go has no nominal-type subbranding
// the way the TypeScript implementation does; the value layer uses
// plain aliases plus package-private validators on construction.

type (
	// GameId is the 64-char hex SHA-256 of the TableOpen outpoint.
	GameId string
	// PlayerId is a 64-char hex identifier derived from the wallet pubkey.
	PlayerId string
	// Seat is a 0-based seat index inside a session.
	Seat int
	// RoundNumber is a 0-based round counter.
	RoundNumber int
	// Hash256 is a 64-char hex SHA-256 digest.
	Hash256 string
	// Pubkey33 is a 66-char hex 33-byte compressed secp256k1 pubkey.
	Pubkey33 string
	// TxId is a 64-char hex transaction id.
	TxId string
	// Outpoint is encoded as `<txid>:<vout>`.
	Outpoint string
	// Satoshis is a non-negative integer count.
	Satoshis uint64
	// BlockHeight is a 0..5e8-1 integer.
	BlockHeight uint32
	// ActionNonce is a 64-char hex per-(player, state) replay-prevention nonce.
	ActionNonce string
	// RuleSetHash is the SHA-256 of the canonical RuleSet encoding.
	RuleSetHash string
)

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)
var pub33 = regexp.MustCompile(`^0[23][0-9a-f]{64}$`)

// AsHash256 validates the hex shape and returns the branded value.
func AsHash256(h string) (Hash256, error) {
	if !hex64.MatchString(h) {
		return "", fmt.Errorf("AsHash256: expected 64 lowercase hex chars, got %q", h)
	}
	return Hash256(h), nil
}

// AsPubkey33 validates the compressed-pubkey shape.
func AsPubkey33(h string) (Pubkey33, error) {
	if !pub33.MatchString(h) {
		return "", fmt.Errorf("AsPubkey33: expected 33-byte compressed pubkey (66 hex starting 02/03), got %q", h)
	}
	return Pubkey33(h), nil
}

// AsGameId validates a 64-hex string.
func AsGameId(h string) (GameId, error) {
	if !hex64.MatchString(h) {
		return "", fmt.Errorf("AsGameId: expected 64 lowercase hex chars")
	}
	return GameId(h), nil
}

// AsRuleSetHash validates a 64-hex string.
func AsRuleSetHash(h string) (RuleSetHash, error) {
	if !hex64.MatchString(h) {
		return "", fmt.Errorf("AsRuleSetHash: expected 64 lowercase hex chars")
	}
	return RuleSetHash(h), nil
}

// AsActionNonce validates a 64-hex string.
func AsActionNonce(h string) (ActionNonce, error) {
	if !hex64.MatchString(h) {
		return "", fmt.Errorf("AsActionNonce: expected 64 lowercase hex chars")
	}
	return ActionNonce(h), nil
}

// AsTxId validates a 64-hex string.
func AsTxId(h string) (TxId, error) {
	if !hex64.MatchString(h) {
		return "", fmt.Errorf("AsTxId: expected 64 lowercase hex chars")
	}
	return TxId(h), nil
}

// AsPlayerId validates a 64-hex string.
func AsPlayerId(h string) (PlayerId, error) {
	if !hex64.MatchString(h) {
		return "", fmt.Errorf("AsPlayerId: expected 64 lowercase hex chars")
	}
	return PlayerId(h), nil
}

// AsSeat validates non-negative range.
func AsSeat(n int) (Seat, error) {
	if n < 0 {
		return 0, fmt.Errorf("AsSeat: expected non-negative integer, got %d", n)
	}
	return Seat(n), nil
}

// AsRoundNumber validates non-negative range.
func AsRoundNumber(n int) (RoundNumber, error) {
	if n < 0 {
		return 0, fmt.Errorf("AsRoundNumber: expected non-negative integer, got %d", n)
	}
	return RoundNumber(n), nil
}

// AsBlockHeight validates the nLockTime height-interpretation range.
func AsBlockHeight(n uint32) (BlockHeight, error) {
	if n >= 500_000_000 {
		return 0, fmt.Errorf("AsBlockHeight: expected integer in [0, 5e8), got %d", n)
	}
	return BlockHeight(n), nil
}

// MustHash256 is a panicking variant for compile-time constants and tests.
func MustHash256(h string) Hash256 {
	v, err := AsHash256(h)
	if err != nil {
		panic(err)
	}
	return v
}

// MustPubkey33 is a panicking variant for compile-time constants and tests.
func MustPubkey33(h string) Pubkey33 {
	v, err := AsPubkey33(h)
	if err != nil {
		panic(err)
	}
	return v
}
