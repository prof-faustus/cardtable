package wsadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"

	"github.com/prof-faustus/cardtable/relay-go/internal/broadcast"
	"github.com/prof-faustus/cardtable/relay-go/internal/session"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
	"github.com/prof-faustus/cardtable/relay-go/pkg/wire"
)

// Config tunes the WebSocket adapter.
type Config struct {
	// Addr is the HTTP listen address (e.g. ":8081").
	Addr string
	// Path is the URL path that accepts WS upgrades (default "/ws").
	Path string
	// CurrentHeight is the block-height callback consulted by the
	// state engine.
	CurrentHeight func() types.BlockHeight
	// Logger is the slog logger.
	Logger *slog.Logger
}

// Server bridges WebSocket clients to the same session+hub backend
// used by the TCP relay (internal/relay). One Server per game_id.
type Server struct {
	cfg     Config
	session *session.Session
	hub     *broadcast.Hub

	srv *http.Server
}

// NewServer constructs a WS adapter backed by the supplied session
// and broadcast hub.
func NewServer(cfg Config, sess *session.Session, hub *broadcast.Hub) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.CurrentHeight == nil {
		cfg.CurrentHeight = func() types.BlockHeight { return 0 }
	}
	if cfg.Path == "" {
		cfg.Path = "/ws"
	}
	return &Server{cfg: cfg, session: sess, hub: hub}
}

// ListenAndServe binds to cfg.Addr and serves until ctx is done.
func (s *Server) ListenAndServe(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc(s.cfg.Path, s.handleUpgrade)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	s.srv = &http.Server{Addr: s.cfg.Addr, Handler: mux}

	ln, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("ws listen %s: %w", s.cfg.Addr, err)
	}
	go func() {
		<-ctx.Done()
		_ = s.srv.Close()
	}()
	s.cfg.Logger.Info("ws adapter listening", "addr", ln.Addr().String(), "path", s.cfg.Path)
	if err := s.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("ws serve: %w", err)
	}
	return nil
}

// Addr returns the bound listener address.
func (s *Server) Addr() string {
	if s.srv == nil {
		return ""
	}
	return s.srv.Addr
}

func (s *Server) handleUpgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := Upgrade(w, r)
	if err != nil {
		s.cfg.Logger.Warn("ws upgrade failed", "err", err, "remote", r.RemoteAddr)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	go s.handleConn(conn)
}

func (s *Server) handleConn(c *Conn) {
	defer c.Close()
	subId, sub := s.hub.Subscribe()
	defer s.hub.Unsubscribe(subId)

	logger := s.cfg.Logger.With("peer", c.RemoteAddr().String(), "sub_id", subId)
	logger.Info("ws connection opened")

	// Writer loop — pump frames from the hub to the WS peer.
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		for f := range sub {
			var buf bytes.Buffer
			if _, err := wire.Encode(&buf, f); err != nil {
				logger.Warn("encode frame", "err", err)
				return
			}
			if err := c.Write(buf.Bytes()); err != nil {
				logger.Warn("ws write", "err", err)
				return
			}
		}
	}()

	for {
		payload, err := c.Read()
		if err != nil {
			if !errors.Is(err, io.EOF) {
				logger.Warn("ws read", "err", err)
			}
			break
		}
		// Decode one wire.Frame from the WS payload.
		f, derr := wire.Decode(bytes.NewReader(payload))
		if derr != nil {
			logger.Warn("decode wire frame", "err", derr)
			s.replyError(subId, types.ErrSerialisation, derr.Error())
			continue
		}
		s.dispatch(logger, subId, f)
	}
	<-writerDone
	logger.Info("ws connection closed")
}

// dispatch is identical in shape to the TCP relay's dispatch method —
// duplicated here rather than refactored into a shared helper because
// the TCP and WS code paths will diverge as the protocol grows (e.g.
// per-transport rate limiting).
func (s *Server) dispatch(logger *slog.Logger, from broadcast.SubscriberId, f wire.Frame) {
	switch f.Type {
	case wire.MsgPing:
		s.send(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgPong, Payload: f.Payload})

	case wire.MsgAction:
		var action types.SignedAction
		if err := json.Unmarshal(f.Payload, &action); err != nil {
			s.replyError(from, types.ErrSerialisation, err.Error())
			return
		}
		height := s.cfg.CurrentHeight()
		next, perr := s.session.Submit(action, height)
		if perr != nil {
			s.replyError(from, perr.Code, perr.Context)
			return
		}
		s.send(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgActionAccepted, Payload: f.Payload})
		s.hub.Publish(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgPeerAction, Payload: f.Payload})
		body, _ := json.Marshal(next)
		s.hub.PublishAll(wire.Frame{Version: wire.Version1_0, Type: wire.MsgTableState, Payload: body})

	case wire.MsgTranscriptRequest:
		entries := s.session.Transcript()
		body, _ := json.Marshal(entries)
		s.send(from, wire.Frame{Version: wire.Version1_0, Type: wire.MsgTranscriptResponse, Payload: body})

	default:
		s.replyError(from, types.ErrUnsupportedVersion, fmt.Sprintf("unsupported type %#x", uint16(f.Type)))
	}
}

func (s *Server) send(to broadcast.SubscriberId, f wire.Frame) {
	s.hub.SendTo(to, f)
}

func (s *Server) replyError(to broadcast.SubscriberId, code types.ErrorCode, ctx string) {
	body, _ := json.Marshal(struct {
		Code    string `json:"code"`
		Context string `json:"context"`
	}{Code: string(code), Context: ctx})
	s.send(to, wire.Frame{Version: wire.Version1_0, Type: wire.MsgErrorReply, Payload: body})
}
