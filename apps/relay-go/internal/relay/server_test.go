package relay

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	"github.com/prof-faustus/cardtable/relay-go/internal/broadcast"
	"github.com/prof-faustus/cardtable/relay-go/internal/session"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
	"github.com/prof-faustus/cardtable/relay-go/pkg/wire"
)

const samplePubkey = "02ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c"

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
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
		},
	}
}

func newTestServer(t *testing.T) (*Server, *session.Session, *broadcast.Hub, context.CancelFunc) {
	t.Helper()
	ruleSet := makeRuleSet()
	sess := session.New("a", ruleSet, "rh", 144)
	hub := broadcast.New(16)
	srv := NewServer(Config{
		Addr:          "127.0.0.1:0",
		ReadTimeout:   2 * time.Second,
		CurrentHeight: func() types.BlockHeight { return 100 },
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, sess, hub)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		_ = srv.ListenAndServe(ctx)
	}()
	// Wait until the listener is bound.
	deadline := time.Now().Add(2 * time.Second)
	for srv.Addr() == "" && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if srv.Addr() == "" {
		cancel()
		t.Fatal("server did not bind within 2s")
	}
	return srv, sess, hub, cancel
}

func TestPingPong(t *testing.T) {
	srv, _, _, cancel := newTestServer(t)
	defer cancel()
	defer srv.Stop()

	conn, err := net.Dial("tcp", srv.Addr())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))

	ping := wire.Frame{Version: wire.Version1_0, Type: wire.MsgPing, Payload: []byte("hi")}
	if _, err := wire.Encode(conn, ping); err != nil {
		t.Fatalf("encode: %v", err)
	}
	pong, err := wire.Decode(conn)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if pong.Type != wire.MsgPong || string(pong.Payload) != "hi" {
		t.Errorf("pong mismatch: %+v", pong)
	}
}

func TestActionAcceptedAndFannedOut(t *testing.T) {
	srv, sess, _, cancel := newTestServer(t)
	defer cancel()
	defer srv.Stop()

	// Open two connections — one sender, one observer.
	sender, err := net.Dial("tcp", srv.Addr())
	if err != nil {
		t.Fatalf("dial sender: %v", err)
	}
	defer sender.Close()
	sender.SetDeadline(time.Now().Add(3 * time.Second))

	observer, err := net.Dial("tcp", srv.Addr())
	if err != nil {
		t.Fatalf("dial observer: %v", err)
	}
	defer observer.Close()
	observer.SetDeadline(time.Now().Add(3 * time.Second))

	// Synchronise: the observer must be fully subscribed on the
	// server side before the sender's Action is dispatched, otherwise
	// the broadcast misses it. A ping-pong round-trip proves the
	// server-side handler goroutine has run far enough to register
	// the observer's subscription with the hub.
	if _, err := wire.Encode(observer, wire.Frame{Version: wire.Version1_0, Type: wire.MsgPing, Payload: []byte("sync")}); err != nil {
		t.Fatalf("observer ping: %v", err)
	}
	pong, err := wire.Decode(observer)
	if err != nil {
		t.Fatalf("observer pong decode: %v", err)
	}
	if pong.Type != wire.MsgPong {
		t.Fatalf("observer pong: want MsgPong, got type=%#x", pong.Type)
	}

	// Build a valid Join action.
	seat := types.Seat(0)
	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: &seat,
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}
	payload, _ := json.Marshal(join)
	if _, err := wire.Encode(sender, wire.Frame{Version: wire.Version1_0, Type: wire.MsgAction, Payload: payload}); err != nil {
		t.Fatalf("encode action: %v", err)
	}

	// Sender should receive MsgActionAccepted and MsgTableState.
	gotAck, gotState := false, false
	for !(gotAck && gotState) {
		f, err := wire.Decode(sender)
		if err != nil {
			t.Fatalf("sender decode: %v", err)
		}
		switch f.Type {
		case wire.MsgActionAccepted:
			gotAck = true
		case wire.MsgTableState:
			gotState = true
		}
	}

	// Observer should receive MsgPeerAction and MsgTableState.
	gotPeer, gotObsState := false, false
	for !(gotPeer && gotObsState) {
		f, err := wire.Decode(observer)
		if err != nil {
			t.Fatalf("observer decode: %v", err)
		}
		switch f.Type {
		case wire.MsgPeerAction:
			gotPeer = true
		case wire.MsgTableState:
			gotObsState = true
		}
	}

	// Session should reflect the join.
	if got := len(sess.State().Players); got != 1 {
		t.Errorf("session players after Join: want 1, got %d", got)
	}
}

func TestActionRejectedReturnsError(t *testing.T) {
	srv, _, _, cancel := newTestServer(t)
	defer cancel()
	defer srv.Stop()

	conn, err := net.Dial("tcp", srv.Addr())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))

	// Stake mismatch -> INVALID_STAKE_AMOUNT.
	seat := types.Seat(0)
	bad := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n_bad",
		ActingPlayerSeat: &seat,
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      999,
	}
	payload, _ := json.Marshal(bad)
	if _, err := wire.Encode(conn, wire.Frame{Version: wire.Version1_0, Type: wire.MsgAction, Payload: payload}); err != nil {
		t.Fatalf("encode: %v", err)
	}

	// First reply should be MsgErrorReply.
	f, err := wire.Decode(conn)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if f.Type != wire.MsgErrorReply {
		t.Fatalf("want MsgErrorReply, got type=%#x", f.Type)
	}
	var body struct {
		Code    string `json:"code"`
		Context string `json:"context"`
	}
	if err := json.Unmarshal(f.Payload, &body); err != nil {
		t.Fatalf("unmarshal error body: %v", err)
	}
	if body.Code != string(types.ErrInvalidStakeAmount) {
		t.Errorf("error code: want INVALID_STAKE_AMOUNT, got %s", body.Code)
	}
}

func TestTranscriptRequest(t *testing.T) {
	srv, _, _, cancel := newTestServer(t)
	defer cancel()
	defer srv.Stop()

	conn, err := net.Dial("tcp", srv.Addr())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(2 * time.Second))

	// Submit one valid Join so the transcript has an entry.
	seat := types.Seat(0)
	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: &seat,
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}
	payload, _ := json.Marshal(join)
	if _, err := wire.Encode(conn, wire.Frame{Version: wire.Version1_0, Type: wire.MsgAction, Payload: payload}); err != nil {
		t.Fatalf("encode action: %v", err)
	}
	// Drain ack + state.
	for i := 0; i < 2; i++ {
		if _, err := wire.Decode(conn); err != nil {
			t.Fatalf("drain: %v", err)
		}
	}

	// Now request the transcript.
	if _, err := wire.Encode(conn, wire.Frame{Version: wire.Version1_0, Type: wire.MsgTranscriptRequest, Payload: nil}); err != nil {
		t.Fatalf("encode transcript request: %v", err)
	}
	f, err := wire.Decode(conn)
	if err != nil {
		t.Fatalf("decode transcript response: %v", err)
	}
	if f.Type != wire.MsgTranscriptResponse {
		t.Fatalf("want MsgTranscriptResponse, got type=%#x", f.Type)
	}
	var entries []types.SignedAction
	if err := json.Unmarshal(f.Payload, &entries); err != nil {
		t.Fatalf("unmarshal transcript: %v", err)
	}
	if len(entries) != 1 {
		t.Errorf("transcript: want 1 entry, got %d", len(entries))
	}
}
