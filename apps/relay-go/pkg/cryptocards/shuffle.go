package cryptocards

import "fmt"

// sha256CounterPrg is the byte-stream PRG used to drive Fisher-Yates.
// See docs/adr/001-sha256-counter-prg-for-shuffle.md.
type sha256CounterPrg struct {
	seed    []byte
	buf     []byte
	offset  int
	counter uint32
}

func newSha256CounterPrg(seed []byte) (*sha256CounterPrg, error) {
	if len(seed) != 32 {
		return nil, fmt.Errorf("sha256CounterPrg: seed must be 32 bytes, got %d", len(seed))
	}
	return &sha256CounterPrg{seed: seed}, nil
}

func (p *sha256CounterPrg) nextByte() byte {
	if p.offset >= len(p.buf) {
		p.buf = Sha256(Concat(p.seed, EncodeU32LE(p.counter)))
		p.counter++
		p.offset = 0
	}
	out := p.buf[p.offset]
	p.offset++
	return out
}

// drawUniform returns an integer uniformly in [0, max] by rejection
// sampling from the byte stream.
func (p *sha256CounterPrg) drawUniform(max uint32) uint32 {
	if max == 0 {
		return 0
	}
	bound := uint64(max) + 1
	limit := (uint64(1) << 32) / bound * bound
	for {
		b0 := uint32(p.nextByte())
		b1 := uint32(p.nextByte())
		b2 := uint32(p.nextByte())
		b3 := uint32(p.nextByte())
		value := b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
		if uint64(value) < limit {
			return uint32(uint64(value) % bound)
		}
	}
}

// ShuffleCanonicalDeck applies Fisher-Yates to [0..deckSize) driven by
// the SHA-256 counter-mode PRG seeded by `combined`.
func ShuffleCanonicalDeck(combined []byte, deckSize int) ([]int, error) {
	if deckSize != 52 && deckSize != 54 {
		return nil, fmt.Errorf("ShuffleCanonicalDeck: unsupported deckSize %d", deckSize)
	}
	deck := make([]int, deckSize)
	for i := 0; i < deckSize; i++ {
		deck[i] = i
	}
	prg, err := newSha256CounterPrg(combined)
	if err != nil {
		return nil, err
	}
	for i := deckSize - 1; i >= 1; i-- {
		j := prg.drawUniform(uint32(i))
		deck[i], deck[j] = deck[j], deck[i]
	}
	return deck, nil
}
