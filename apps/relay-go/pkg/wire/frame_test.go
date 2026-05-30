package wire

import (
	"bytes"
	"errors"
	"io"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	payload := []byte(`{"hello":"world"}`)
	in := Frame{Version: Version1_0, Type: MsgAction, Payload: payload}
	var buf bytes.Buffer
	n, err := Encode(&buf, in)
	if err != nil {
		t.Fatalf("Encode: %v", err)
	}
	if want := HeaderSize + len(payload); n != want {
		t.Errorf("Encode wrote %d bytes, want %d", n, want)
	}
	out, err := Decode(&buf)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Version != in.Version || out.Type != in.Type {
		t.Errorf("Decode mismatch: %+v vs %+v", out, in)
	}
	if !bytes.Equal(out.Payload, in.Payload) {
		t.Errorf("payload mismatch: %x vs %x", out.Payload, in.Payload)
	}
}

func TestEmptyPayload(t *testing.T) {
	in := Frame{Version: Version1_0, Type: MsgPing, Payload: nil}
	var buf bytes.Buffer
	if _, err := Encode(&buf, in); err != nil {
		t.Fatalf("Encode: %v", err)
	}
	out, err := Decode(&buf)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Type != MsgPing {
		t.Errorf("type mismatch: got %x, want %x", out.Type, MsgPing)
	}
	if len(out.Payload) != 0 {
		t.Errorf("payload should be empty, got %d bytes", len(out.Payload))
	}
}

func TestBadMagic(t *testing.T) {
	bad := []byte{0xFF, 0xFF, 0xFF, 0xFF, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	_, err := Decode(bytes.NewReader(bad))
	if !errors.Is(err, ErrBadMagic) {
		t.Errorf("want ErrBadMagic, got %v", err)
	}
}

func TestBadChecksum(t *testing.T) {
	var buf bytes.Buffer
	in := Frame{Version: Version1_0, Type: MsgAction, Payload: []byte("abc")}
	if _, err := Encode(&buf, in); err != nil {
		t.Fatalf("Encode: %v", err)
	}
	// Corrupt the checksum byte (offset 12).
	raw := buf.Bytes()
	raw[12] ^= 0xFF
	_, err := Decode(bytes.NewReader(raw))
	if !errors.Is(err, ErrBadChecksum) {
		t.Errorf("want ErrBadChecksum, got %v", err)
	}
}

func TestOversizedPayload(t *testing.T) {
	in := Frame{Version: Version1_0, Type: MsgAction, Payload: make([]byte, MaxPayloadSize+1)}
	_, err := Encode(io.Discard, in)
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("want ErrPayloadTooLarge, got %v", err)
	}
}

func TestDecodeRejectsOversized(t *testing.T) {
	// Hand-craft a header declaring length = MaxPayloadSize+1.
	var hdr [HeaderSize]byte
	copy(hdr[0:4], Magic[:])
	hdr[4] = 0
	hdr[5] = 1 // version 0x0100
	hdr[6] = 0x02
	hdr[7] = 0x03
	// length = MaxPayloadSize + 1 = 0x02000001
	hdr[8] = 0x01
	hdr[9] = 0x00
	hdr[10] = 0x00
	hdr[11] = 0x02
	_, err := Decode(bytes.NewReader(hdr[:]))
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("want ErrPayloadTooLarge, got %v", err)
	}
}

func TestShortRead(t *testing.T) {
	_, err := Decode(bytes.NewReader([]byte{0x43, 0x41})) // only 2 bytes of magic
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Errorf("want io.ErrUnexpectedEOF, got %v", err)
	}
}

func TestMultipleFramesBackToBack(t *testing.T) {
	var buf bytes.Buffer
	for i := 0; i < 5; i++ {
		if _, err := Encode(&buf, Frame{Version: Version1_0, Type: MsgPing, Payload: []byte{byte(i)}}); err != nil {
			t.Fatalf("Encode %d: %v", i, err)
		}
	}
	for i := 0; i < 5; i++ {
		f, err := Decode(&buf)
		if err != nil {
			t.Fatalf("Decode %d: %v", i, err)
		}
		if len(f.Payload) != 1 || f.Payload[0] != byte(i) {
			t.Errorf("frame %d: payload mismatch %v", i, f.Payload)
		}
	}
}
