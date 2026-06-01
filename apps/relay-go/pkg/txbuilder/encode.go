package txbuilder

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
)

// EncVarint returns the Bitcoin-style varint encoding of n.
func EncVarint(n uint64) []byte {
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

// EncU32LE returns a 4-byte little-endian encoding of n.
func EncU32LE(n uint32) []byte {
	out := make([]byte, 4)
	binary.LittleEndian.PutUint32(out, n)
	return out
}

// EncI32LE returns a 4-byte little-endian encoding of n.
func EncI32LE(n int32) []byte {
	out := make([]byte, 4)
	binary.LittleEndian.PutUint32(out, uint32(n))
	return out
}

// EncU64LE returns an 8-byte little-endian encoding of n.
func EncU64LE(n uint64) []byte {
	out := make([]byte, 8)
	binary.LittleEndian.PutUint64(out, n)
	return out
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

// EncodeBsvTransaction returns the canonical wire-format bytes of tx.
func EncodeBsvTransaction(tx BsvTransaction) ([]byte, error) {
	parts := [][]byte{EncI32LE(tx.Version), EncVarint(uint64(len(tx.Inputs)))}
	for i, in := range tx.Inputs {
		if len(in.PrevTxid) != 32 {
			return nil, fmt.Errorf("EncodeBsvTransaction: input %d prevTxid must be 32 bytes, got %d", i, len(in.PrevTxid))
		}
		parts = append(parts,
			in.PrevTxid,
			EncU32LE(in.PrevVout),
			EncVarint(uint64(len(in.UnlockingScript))),
			in.UnlockingScript,
			EncU32LE(in.Sequence),
		)
	}
	parts = append(parts, EncVarint(uint64(len(tx.Outputs))))
	for _, o := range tx.Outputs {
		parts = append(parts,
			EncU64LE(o.Value),
			EncVarint(uint64(len(o.LockingScript))),
			o.LockingScript,
		)
	}
	parts = append(parts, EncU32LE(tx.LockTime))
	return concat(parts...), nil
}

// cursor / decoder helpers ----------------------------------------------------

type cursor struct {
	buf []byte
	pos int
}

func (c *cursor) readU8() (byte, error) {
	if c.pos >= len(c.buf) {
		return 0, fmt.Errorf("decode: out of bounds u8")
	}
	b := c.buf[c.pos]
	c.pos++
	return b, nil
}

func (c *cursor) readN(n int) ([]byte, error) {
	if c.pos+n > len(c.buf) {
		return nil, fmt.Errorf("decode: out of bounds bytes (want %d, have %d)", n, len(c.buf)-c.pos)
	}
	out := make([]byte, n)
	copy(out, c.buf[c.pos:c.pos+n])
	c.pos += n
	return out, nil
}

func (c *cursor) readU16LE() (uint16, error) {
	b, err := c.readN(2)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint16(b), nil
}

func (c *cursor) readU32LE() (uint32, error) {
	b, err := c.readN(4)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(b), nil
}

func (c *cursor) readU64LE() (uint64, error) {
	b, err := c.readN(8)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint64(b), nil
}

func (c *cursor) readVarint() (uint64, error) {
	first, err := c.readU8()
	if err != nil {
		return 0, err
	}
	switch {
	case first < 0xfd:
		return uint64(first), nil
	case first == 0xfd:
		v, err := c.readU16LE()
		return uint64(v), err
	case first == 0xfe:
		v, err := c.readU32LE()
		return uint64(v), err
	default:
		return c.readU64LE()
	}
}

// DecodeBsvTransaction parses the canonical wire-format bytes.
func DecodeBsvTransaction(buf []byte) (BsvTransaction, error) {
	c := &cursor{buf: buf}
	versionU, err := c.readU32LE()
	if err != nil {
		return BsvTransaction{}, fmt.Errorf("decode version: %w", err)
	}
	inputCount, err := c.readVarint()
	if err != nil {
		return BsvTransaction{}, fmt.Errorf("decode input_count: %w", err)
	}
	inputs := make([]TxInput, inputCount)
	for i := range inputs {
		prevTxid, err := c.readN(32)
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("input %d prevTxid: %w", i, err)
		}
		prevVout, err := c.readU32LE()
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("input %d prevVout: %w", i, err)
		}
		scriptLen, err := c.readVarint()
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("input %d scriptLen: %w", i, err)
		}
		script, err := c.readN(int(scriptLen))
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("input %d script: %w", i, err)
		}
		sequence, err := c.readU32LE()
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("input %d sequence: %w", i, err)
		}
		inputs[i] = TxInput{PrevTxid: prevTxid, PrevVout: prevVout, UnlockingScript: script, Sequence: sequence}
	}
	outputCount, err := c.readVarint()
	if err != nil {
		return BsvTransaction{}, fmt.Errorf("decode output_count: %w", err)
	}
	outputs := make([]TxOutput, outputCount)
	for i := range outputs {
		value, err := c.readU64LE()
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("output %d value: %w", i, err)
		}
		scriptLen, err := c.readVarint()
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("output %d scriptLen: %w", i, err)
		}
		script, err := c.readN(int(scriptLen))
		if err != nil {
			return BsvTransaction{}, fmt.Errorf("output %d script: %w", i, err)
		}
		outputs[i] = TxOutput{Value: value, LockingScript: script}
	}
	lockTime, err := c.readU32LE()
	if err != nil {
		return BsvTransaction{}, fmt.Errorf("decode lockTime: %w", err)
	}
	if c.pos != len(buf) {
		return BsvTransaction{}, fmt.Errorf("DecodeBsvTransaction: trailing bytes (%d of %d consumed)", c.pos, len(buf))
	}
	return BsvTransaction{
		Version:  int32(versionU),
		Inputs:   inputs,
		Outputs:  outputs,
		LockTime: lockTime,
	}, nil
}

func sha256d(b []byte) []byte {
	first := sha256.Sum256(b)
	second := sha256.Sum256(first[:])
	return second[:]
}

// ComputeTxId returns the 32-byte txid in internal byte order.
func ComputeTxId(tx BsvTransaction) ([]byte, error) {
	b, err := EncodeBsvTransaction(tx)
	if err != nil {
		return nil, err
	}
	return sha256d(b), nil
}
