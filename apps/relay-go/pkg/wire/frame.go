package wire

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Frame is a parsed wire frame. `Payload` is owned by the frame; the
// caller may retain it after Decode returns.
type Frame struct {
	Version uint16
	Type    MsgType
	Payload []byte
}

// ErrBadMagic is returned when the leading 4 bytes are not "CARD".
var ErrBadMagic = errors.New("wire: bad magic (expected CARD)")

// ErrBadChecksum is returned when the frame checksum does not match
// the SHA-256 prefix of the payload.
var ErrBadChecksum = errors.New("wire: bad payload checksum")

// ErrPayloadTooLarge is returned when the declared Length exceeds
// MaxPayloadSize.
var ErrPayloadTooLarge = errors.New("wire: payload too large")

// Encode writes the frame to w. The returned byte count is the
// number of bytes written (header + payload).
func Encode(w io.Writer, f Frame) (int, error) {
	if len(f.Payload) > MaxPayloadSize {
		return 0, fmt.Errorf("%w: %d > %d", ErrPayloadTooLarge, len(f.Payload), MaxPayloadSize)
	}
	var header [HeaderSize]byte
	copy(header[0:4], Magic[:])
	binary.LittleEndian.PutUint16(header[4:6], f.Version)
	binary.LittleEndian.PutUint16(header[6:8], uint16(f.Type))
	binary.LittleEndian.PutUint32(header[8:12], uint32(len(f.Payload)))
	copy(header[12:16], checksum(f.Payload))

	n, err := w.Write(header[:])
	if err != nil {
		return n, err
	}
	if len(f.Payload) == 0 {
		return n, nil
	}
	m, err := w.Write(f.Payload)
	return n + m, err
}

// Decode reads exactly one frame from r. The returned Frame's Payload
// is freshly allocated. Errors include ErrBadMagic, ErrBadChecksum,
// ErrPayloadTooLarge, and the I/O errors propagated from r.
func Decode(r io.Reader) (Frame, error) {
	var header [HeaderSize]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Frame{}, err
	}
	if header[0] != Magic[0] || header[1] != Magic[1] || header[2] != Magic[2] || header[3] != Magic[3] {
		return Frame{}, ErrBadMagic
	}
	ver := binary.LittleEndian.Uint16(header[4:6])
	typ := MsgType(binary.LittleEndian.Uint16(header[6:8]))
	length := binary.LittleEndian.Uint32(header[8:12])
	if length > MaxPayloadSize {
		return Frame{}, fmt.Errorf("%w: %d > %d", ErrPayloadTooLarge, length, MaxPayloadSize)
	}
	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return Frame{}, err
		}
	}
	want := checksum(payload)
	got := header[12:16]
	if got[0] != want[0] || got[1] != want[1] || got[2] != want[2] || got[3] != want[3] {
		return Frame{}, ErrBadChecksum
	}
	return Frame{Version: ver, Type: typ, Payload: payload}, nil
}

// checksum returns the first 4 bytes of SHA-256(payload). Single
// SHA-256, per spec §1.
func checksum(payload []byte) []byte {
	h := sha256.Sum256(payload)
	return h[:4]
}
