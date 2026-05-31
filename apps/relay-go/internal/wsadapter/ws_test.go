package wsadapter

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/prof-faustus/cardtable/relay-go/internal/broadcast"
	"github.com/prof-faustus/cardtable/relay-go/internal/session"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
	"github.com/prof-faustus/cardtable/relay-go/pkg/wire"
)

func makeRuleSet() types.RuleSet {
	return types.RuleSet{
		GameType:              types.GameInBetween,
		PlayerCountMin:        2,
		PlayerCountMax:        4,
		StakeAmount:           1000,
		MinBet:                1,
		MaxBet:                100,
		DecisionTimeoutBlocks: 6,
		RecoveryTimeoutBlocks: 144,
		DeckFormat:            52,
		ShuffleAlgorithmVersion: 1,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
		},
	}
}

// rawWsClient is a minimal WS client built on a hijacked TCP conn —
// enough to exchange one binary frame and read one back.
type rawWsClient struct {
	conn net.Conn
}

func dialAndUpgrade(t *testing.T, url string) *rawWsClient {
	t.Helper()
	u := strings.TrimPrefix(url, "http://")
	conn, err := net.Dial("tcp", u)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.SetDeadline(time.Now().Add(3 * time.Second))

	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		t.Fatalf("random key: %v", err)
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)

	req := fmt.Sprintf(
		"GET /ws HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n\r\n",
		u, key,
	)
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write handshake: %v", err)
	}
	// Read the 101 response line + headers.
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read handshake response: %v", err)
	}
	resp := string(buf[:n])
	if !strings.HasPrefix(resp, "HTTP/1.1 101") {
		t.Fatalf("handshake did not return 101: %q", resp)
	}
	return &rawWsClient{conn: conn}
}

// writeBinary sends one masked binary frame.
func (c *rawWsClient) writeBinary(t *testing.T, payload []byte) {
	t.Helper()
	hdr := []byte{0x82} // FIN + opcode 0x2 (binary)
	switch {
	case len(payload) < 126:
		hdr = append(hdr, 0x80|byte(len(payload)))
	case len(payload) <= 0xffff:
		hdr = append(hdr, 0x80|126)
		var ext [2]byte
		binary.BigEndian.PutUint16(ext[:], uint16(len(payload)))
		hdr = append(hdr, ext[:]...)
	default:
		hdr = append(hdr, 0x80|127)
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(len(payload)))
		hdr = append(hdr, ext[:]...)
	}
	var maskKey [4]byte
	_, _ = rand.Read(maskKey[:])
	hdr = append(hdr, maskKey[:]...)
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ maskKey[i%4]
	}
	if _, err := c.conn.Write(append(hdr, masked...)); err != nil {
		t.Fatalf("ws write: %v", err)
	}
}

// readBinary reads one unmasked binary frame from the server.
func (c *rawWsClient) readBinary(t *testing.T) []byte {
	t.Helper()
	hdr := make([]byte, 2)
	if _, err := io.ReadFull(c.conn, hdr); err != nil {
		t.Fatalf("ws read header: %v", err)
	}
	opcode := hdr[0] & 0x0f
	if opcode != 0x2 {
		t.Fatalf("expected binary opcode, got 0x%x", opcode)
	}
	plen := uint64(hdr[1] & 0x7f)
	switch plen {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(c.conn, ext[:]); err != nil {
			t.Fatalf("ws read ext16: %v", err)
		}
		plen = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(c.conn, ext[:]); err != nil {
			t.Fatalf("ws read ext64: %v", err)
		}
		plen = binary.BigEndian.Uint64(ext[:])
	}
	payload := make([]byte, plen)
	if _, err := io.ReadFull(c.conn, payload); err != nil {
		t.Fatalf("ws read payload: %v", err)
	}
	return payload
}

func TestWsHandshakeAndPing(t *testing.T) {
	rs := makeRuleSet()
	sess := session.New("a", rs, "rh", 144)
	hub := broadcast.New(16)
	wsSrv := NewServer(Config{
		Path:          "/ws",
		CurrentHeight: func() types.BlockHeight { return 100 },
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, sess, hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", wsSrv.handleUpgrade)
	httpSrv := httptest.NewServer(mux)
	defer httpSrv.Close()

	c := dialAndUpgrade(t, httpSrv.URL)
	defer c.conn.Close()

	// Send Ping (one wire frame inside one WS binary frame).
	var pingBuf bytes.Buffer
	if _, err := wire.Encode(&pingBuf, wire.Frame{Version: wire.Version1_0, Type: wire.MsgPing, Payload: []byte("hi")}); err != nil {
		t.Fatalf("encode ping: %v", err)
	}
	c.writeBinary(t, pingBuf.Bytes())

	// Read the WS binary frame, then decode the wire frame inside.
	pongPayload := c.readBinary(t)
	pong, err := wire.Decode(bytes.NewReader(pongPayload))
	if err != nil {
		t.Fatalf("decode pong: %v", err)
	}
	if pong.Type != wire.MsgPong {
		t.Fatalf("want MsgPong, got %#x", pong.Type)
	}
	if string(pong.Payload) != "hi" {
		t.Errorf("pong payload: want %q, got %q", "hi", pong.Payload)
	}
	_ = context.Background()
}

func TestWsActionAccepted(t *testing.T) {
	rs := makeRuleSet()
	sess := session.New("a", rs, "rh", 144)
	hub := broadcast.New(16)
	wsSrv := NewServer(Config{
		Path:          "/ws",
		CurrentHeight: func() types.BlockHeight { return 100 },
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, sess, hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", wsSrv.handleUpgrade)
	httpSrv := httptest.NewServer(mux)
	defer httpSrv.Close()

	c := dialAndUpgrade(t, httpSrv.URL)
	defer c.conn.Close()

	seat := types.Seat(0)
	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: &seat,
		PlayerPubkey:     "02ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c",
		StakeAmount:      1000,
	}
	body, _ := json.Marshal(join)
	var buf bytes.Buffer
	if _, err := wire.Encode(&buf, wire.Frame{Version: wire.Version1_0, Type: wire.MsgAction, Payload: body}); err != nil {
		t.Fatalf("encode action: %v", err)
	}
	c.writeBinary(t, buf.Bytes())

	// Expect MsgActionAccepted then MsgTableState in some order.
	got := map[wire.MsgType]bool{}
	for i := 0; i < 2; i++ {
		f, err := wire.Decode(bytes.NewReader(c.readBinary(t)))
		if err != nil {
			t.Fatalf("decode reply %d: %v", i, err)
		}
		got[f.Type] = true
	}
	if !got[wire.MsgActionAccepted] {
		t.Error("did not receive MsgActionAccepted")
	}
	if !got[wire.MsgTableState] {
		t.Error("did not receive MsgTableState")
	}
}
