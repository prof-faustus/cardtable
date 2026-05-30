// Package cryptocards is the Go peer of @cardtable/crypto-cards.
//
// Every function in this package mirrors the TypeScript implementation
// byte-for-byte: the test vector at spec/test-vectors/mental-poker.json
// is the conformance surface that binds them together.
package cryptocards

import (
	"crypto/subtle"
	"encoding/binary"
	"fmt"
)

// EncodeU8 returns a 1-byte slice holding n. n MUST be in [0, 255].
func EncodeU8(n int) ([]byte, error) {
	if n < 0 || n > 0xff {
		return nil, fmt.Errorf("EncodeU8: out of range: %d", n)
	}
	return []byte{byte(n)}, nil
}

// EncodeU16LE returns a 2-byte little-endian encoding of n.
func EncodeU16LE(n int) ([]byte, error) {
	if n < 0 || n > 0xffff {
		return nil, fmt.Errorf("EncodeU16LE: out of range: %d", n)
	}
	out := make([]byte, 2)
	binary.LittleEndian.PutUint16(out, uint16(n))
	return out, nil
}

// EncodeU32LE returns a 4-byte little-endian encoding of n.
func EncodeU32LE(n uint32) []byte {
	out := make([]byte, 4)
	binary.LittleEndian.PutUint32(out, n)
	return out
}

// EncodeBytes32 verifies the slice is exactly 32 bytes and returns it.
func EncodeBytes32(b []byte) ([]byte, error) {
	if len(b) != 32 {
		return nil, fmt.Errorf("EncodeBytes32: expected 32 bytes, got %d", len(b))
	}
	return b, nil
}

// EncodeVarint returns the Bitcoin-style variable-length integer
// encoding of n.
func EncodeVarint(n uint64) []byte {
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

// Concat appends every supplied slice into a fresh slice.
func Concat(parts ...[]byte) []byte {
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

// ConstantTimeEqual reports whether two byte slices are byte-equal,
// in constant time.
func ConstantTimeEqual(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}
