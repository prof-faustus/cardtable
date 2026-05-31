// Package wsadapter implements just enough of RFC 6455 to carry the
// cardtable binary wire-protocol frames between a browser client and
// the Go relay. Stdlib only; no third-party dependency.
//
// Supported subset:
//   - Opcode 0x1 (text) — rejected (we use binary only)
//   - Opcode 0x2 (binary) — carries one wire.Frame per WS frame
//   - Opcode 0x8 (close) — graceful shutdown
//   - Opcode 0x9 (ping) — answered with a pong
//   - Opcode 0xa (pong) — ignored
//
// Not supported (this is a reference relay, not a general WS server):
//   - Fragmentation across multiple WS frames
//   - Permessage-deflate / extensions
//   - Sub-protocols
//
// Mask handling: client-to-server frames MUST be masked per RFC 6455
// §5.1; we enforce that. Server-to-client frames MUST NOT be masked.
package wsadapter

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// WS opcodes.
const (
	opcodeContinuation byte = 0x0
	opcodeText         byte = 0x1
	opcodeBinary       byte = 0x2
	opcodeClose        byte = 0x8
	opcodePing         byte = 0x9
	opcodePong         byte = 0xa
)

// maxPayloadSize caps inbound WS frame payloads at 32 MiB — the same
// limit the wire protocol enforces.
const maxPayloadSize = 32 * 1024 * 1024

// Conn is one upgraded WebSocket connection.
type Conn struct {
	raw    net.Conn
	reader *bufio.Reader
}

// Upgrade performs the RFC 6455 handshake and returns a Conn. The
// supplied http.ResponseWriter must implement http.Hijacker; net/http
// guarantees this for the default server.
func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return nil, fmt.Errorf("ws: Upgrade header is not 'websocket'")
	}
	if !strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		return nil, fmt.Errorf("ws: Connection header missing 'upgrade'")
	}
	if r.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, fmt.Errorf("ws: only Sec-WebSocket-Version 13 supported")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, fmt.Errorf("ws: missing Sec-WebSocket-Key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, fmt.Errorf("ws: ResponseWriter does not support hijacking")
	}
	rawConn, brw, err := hj.Hijack()
	if err != nil {
		return nil, fmt.Errorf("ws: hijack failed: %w", err)
	}
	accept := acceptKey(key)
	resp := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := rawConn.Write([]byte(resp)); err != nil {
		_ = rawConn.Close()
		return nil, fmt.Errorf("ws: write handshake response: %w", err)
	}
	return &Conn{raw: rawConn, reader: brw.Reader}, nil
}

// Close sends a close frame and shuts the underlying conn.
func (c *Conn) Close() error {
	_ = c.writeFrame(opcodeClose, nil)
	return c.raw.Close()
}

// Read returns the next binary payload from the peer. Control frames
// (ping, pong, close) are handled internally. A close frame yields
// io.EOF.
func (c *Conn) Read() ([]byte, error) {
	for {
		opcode, payload, err := c.readFrame()
		if err != nil {
			return nil, err
		}
		switch opcode {
		case opcodeBinary:
			return payload, nil
		case opcodeText:
			return nil, fmt.Errorf("ws: text frames not supported")
		case opcodeClose:
			return nil, io.EOF
		case opcodePing:
			// Echo the ping payload back as a pong.
			if err := c.writeFrame(opcodePong, payload); err != nil {
				return nil, err
			}
		case opcodePong:
			// Ignored.
		default:
			return nil, fmt.Errorf("ws: unknown opcode 0x%x", opcode)
		}
	}
}

// Write delivers a binary payload to the peer.
func (c *Conn) Write(p []byte) error {
	return c.writeFrame(opcodeBinary, p)
}

// RemoteAddr returns the peer address.
func (c *Conn) RemoteAddr() net.Addr { return c.raw.RemoteAddr() }

// ---------------------------------------------------------------------------
// Internal frame I/O
// ---------------------------------------------------------------------------

func (c *Conn) readFrame() (opcode byte, payload []byte, err error) {
	var hdr [2]byte
	if _, err = io.ReadFull(c.reader, hdr[:]); err != nil {
		return 0, nil, err
	}
	fin := hdr[0] & 0x80
	opcode = hdr[0] & 0x0f
	if fin == 0 {
		// Fragmentation not supported.
		return 0, nil, fmt.Errorf("ws: fragmented frames not supported")
	}
	mask := hdr[1] & 0x80
	if mask == 0 {
		// All client-to-server frames MUST be masked.
		return 0, nil, fmt.Errorf("ws: peer frame is not masked")
	}
	plen := uint64(hdr[1] & 0x7f)
	switch plen {
	case 126:
		var ext [2]byte
		if _, err = io.ReadFull(c.reader, ext[:]); err != nil {
			return 0, nil, err
		}
		plen = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err = io.ReadFull(c.reader, ext[:]); err != nil {
			return 0, nil, err
		}
		plen = binary.BigEndian.Uint64(ext[:])
	}
	if plen > maxPayloadSize {
		return 0, nil, fmt.Errorf("ws: payload too large (%d > %d)", plen, maxPayloadSize)
	}
	var maskKey [4]byte
	if _, err = io.ReadFull(c.reader, maskKey[:]); err != nil {
		return 0, nil, err
	}
	payload = make([]byte, plen)
	if _, err = io.ReadFull(c.reader, payload); err != nil {
		return 0, nil, err
	}
	for i := range payload {
		payload[i] ^= maskKey[i%4]
	}
	return opcode, payload, nil
}

func (c *Conn) writeFrame(opcode byte, payload []byte) error {
	hdr := make([]byte, 0, 14)
	hdr = append(hdr, 0x80|opcode) // FIN + opcode
	switch {
	case len(payload) < 126:
		hdr = append(hdr, byte(len(payload)))
	case len(payload) <= 0xffff:
		hdr = append(hdr, 126)
		var ext [2]byte
		binary.BigEndian.PutUint16(ext[:], uint16(len(payload)))
		hdr = append(hdr, ext[:]...)
	default:
		hdr = append(hdr, 127)
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(len(payload)))
		hdr = append(hdr, ext[:]...)
	}
	if _, err := c.raw.Write(hdr); err != nil {
		return err
	}
	if len(payload) > 0 {
		if _, err := c.raw.Write(payload); err != nil {
			return err
		}
	}
	return nil
}

// acceptKey computes the RFC 6455 §1.3 Sec-WebSocket-Accept value.
func acceptKey(clientKey string) string {
	h := sha1.New()
	h.Write([]byte(clientKey))
	h.Write([]byte(wsGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// ErrClosed is the sentinel returned from Read after a close frame.
var ErrClosed = errors.New("ws: connection closed by peer")
