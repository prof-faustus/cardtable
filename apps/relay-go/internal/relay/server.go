// Package relay is the binary-protocol relay server. The transport
// layer is plain TCP for now; a WebSocket adapter will be bolted on
// when apps/client-web lands. The wire format and message semantics
// are identical to spec/wire-protocol.md §3.4 either way.
package relay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"sync"
	"time"

	"github.com/prof-faustus/cardtable/relay-go/internal/broadcast"
	"github.com/prof-faustus/cardtable/relay-go/internal/session"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
	"github.com/prof-faustus/cardtable/relay-go/pkg/wire"
)

// Config tunes the relay server.
type Config struct {
	// Addr is the listen address (e.g. ":8080").
	Addr string

	// ReadTimeout caps the per-frame read deadline. Zero means no
	// deadline.
	ReadTimeout time.Duration

	// CurrentHeight is a callback returning the chain height the
	// relay believes is current. The state engine consults this for
	// timeout maturity. Production builds plug in an SPV header
	// service; the reference binary uses a manual height for testing.
	CurrentHeight func() types.BlockHeight

	// Logger is the slog logger. nil disables logging.
	Logger *slog.Logger
}

// Server is a single-table relay. Multi-table fan-out is handled by
// composing one Server per game_id.
type Server struct {
	cfg     Config
	session *session.Session
	hub     *broadcast.Hub

	mu        sync.Mutex
	listening net.Listener
}

// NewServer constructs a relay backed by the given session and
// broadcast hub. Caller owns both lifetimes.
func NewServer(cfg Config, sess *session.Session, hub *broadcast.Hub) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.CurrentHeight == nil {
		cfg.CurrentHeight = func() types.BlockHeight { return 0 }
	}
	return &Server{cfg: cfg, session: sess, hub: hub}
}

// ListenAndServe binds to cfg.Addr and serves until ctx is done or
// the listener errors fatally. Errors that are net.ErrClosed from a
// graceful Stop() are nil-returned.
func (s *Server) ListenAndServe(ctx context.Context) error {
	l, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.cfg.Addr, err)
	}
	s.mu.Lock()
	s.listening = l
	s.mu.Unlock()
	s.cfg.Logger.Info("relay listening", "addr", l.Addr().String())

	// Close the listener when ctx is cancelled so Accept returns.
	go func() {
		<-ctx.Done()
		_ = l.Close()
	}()

	for {
		conn, err := l.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}
			return fmt.Errorf("accept: %w", err)
		}
		go s.handle(ctx, conn)
	}
}

// Stop closes the listener; in-flight connections drain naturally
// when their peer disconnects or ctx is done.
func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listening == nil {
		return nil
	}
	err := s.listening.Close()
	s.listening = nil
	return err
}

// Addr returns the bound listener address, or "" if not listening.
func (s *Server) Addr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listening == nil {
		return ""
	}
	return s.listening.Addr().String()
}

// ---------------------------------------------------------------------------
// Per-connection handler
// ---------------------------------------------------------------------------

func (s *Server) handle(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	subId, sub := s.hub.Subscribe()
	defer s.hub.Unsubscribe(subId)

	logger := s.cfg.Logger.With("peer", conn.RemoteAddr().String(), "sub_id", subId)
	logger.Info("connection opened")

	// Outbound writer loop.
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for {
			select {
			case f, ok := <-sub:
				if !ok {
					return
				}
				if _, err := wire.Encode(conn, f); err != nil {
					logger.Warn("encode failed; closing connection", "err", err)
					_ = conn.Close()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()

	// Inbound reader loop.
	for {
		if s.cfg.ReadTimeout > 0 {
			_ = conn.SetReadDeadline(time.Now().Add(s.cfg.ReadTimeout))
		}
		f, err := wire.Decode(conn)
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
				logger.Warn("decode failed; closing connection", "err", err)
			}
			break
		}
		s.dispatch(logger, subId, f)
	}

	// Reader exited — make sure the writer loop notices.
	_ = conn.Close()
	<-writerDone
	logger.Info("connection closed")
}

// dispatch is the per-frame router. Action-class frames are validated
// through the session; if accepted, the state is broadcast back to
// the other subscribers as PEER_ACTION.
func (s *Server) dispatch(logger *slog.Logger, from broadcast.SubscriberId, f wire.Frame) {
	switch f.Type {
	case wire.MsgPing:
		s.replyOne(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgPong, Payload: f.Payload})

	case wire.MsgAction:
		var action types.SignedAction
		if err := json.Unmarshal(f.Payload, &action); err != nil {
			logger.Warn("malformed Action payload", "err", err)
			s.replyError(from, types.ErrSerialisation, err.Error())
			return
		}
		height := s.cfg.CurrentHeight()
		next, perr := s.session.Submit(action, height)
		if perr != nil {
			s.replyError(from, perr.Code, perr.Context)
			return
		}
		// Ack to sender.
		s.replyOne(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgActionAccepted, Payload: f.Payload})
		// Fan out to peers.
		s.hub.Publish(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgPeerAction, Payload: f.Payload})
		// Broadcast the new TABLE_STATE to everyone.
		body, mErr := json.Marshal(next)
		if mErr != nil {
			logger.Warn("marshal TABLE_STATE", "err", mErr)
			return
		}
		s.hub.PublishAll(wire.Frame{Version: wire.Version1_0, Type: wire.MsgTableState, Payload: body})

	case wire.MsgTranscriptRequest:
		entries := s.session.Transcript()
		body, err := json.Marshal(entries)
		if err != nil {
			logger.Warn("marshal transcript", "err", err)
			return
		}
		s.replyOne(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgTranscriptResponse, Payload: body})

	default:
		// Unknown / unsupported message type — protocol §8 says REJECT
		// with code UNKNOWN_TYPE. For now we just send an ERROR back.
		s.replyError(from, types.ErrUnsupportedVersion, fmt.Sprintf("unsupported type %#x", uint16(f.Type)))
	}
}

func (s *Server) replyOne(to broadcast.SubscriberId, f wire.Frame) {
	s.hub.SendTo(to, f)
}

func (s *Server) replyError(to broadcast.SubscriberId, code types.ErrorCode, ctx string) {
	body, _ := json.Marshal(struct {
		Code    string `json:"code"`
		Context string `json:"context"`
	}{Code: string(code), Context: ctx})
	s.replyOne(to, wire.Frame{Version: wire.Version1_0, Type: wire.MsgErrorReply, Payload: body})
}
