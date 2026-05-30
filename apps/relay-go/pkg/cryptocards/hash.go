package cryptocards

import "crypto/sha256"

// Canonical type tags used in this package (mirrors hash.ts).
const (
	TagEntropyCommitment uint16 = 0x0005
	TagEntropyReveal     uint16 = 0x0006
	TagDeckCommitment    uint16 = 0x0007
	TagCard              uint16 = 0x0008
	TagRevealProof       uint16 = 0x000c
)

// DomainHash returns SHA-256(typeTag (u16 LE) || parts...).
func DomainHash(typeTag uint16, parts ...[]byte) []byte {
	tag, _ := EncodeU16LE(int(typeTag))
	input := Concat(append([][]byte{tag}, parts...)...)
	return Sha256(input)
}

// Sha256 returns the raw 32-byte SHA-256 of input. No domain
// separation; used as the PRG primitive.
func Sha256(input []byte) []byte {
	h := sha256.Sum256(input)
	return h[:]
}
