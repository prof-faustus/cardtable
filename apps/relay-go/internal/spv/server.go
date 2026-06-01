package spv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strconv"
)

// ServerConfig tunes the SPV HTTP server.
type ServerConfig struct {
	Addr   string
	Logger *slog.Logger
}

// Server exposes the cache + RPC over a small HTTP API:
//
//	GET  /healthz                        -> 200 "ok"
//	GET  /headers/latest                 -> { tip: u32 }
//	GET  /headers/{height}               -> BlockHeader JSON
//	GET  /merkle-proof?txid=<64-hex>     -> MerkleProof JSON
//
// All responses are JSON except /healthz.
type Server struct {
	cfg   ServerConfig
	cache *HeaderCache
	rpc   BsvRPC
	srv   *http.Server
}

// NewServer wires the HTTP handlers.
func NewServer(cfg ServerConfig, cache *HeaderCache, rpc BsvRPC) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Server{cfg: cfg, cache: cache, rpc: rpc}
}

// ListenAndServe binds on cfg.Addr and serves until ctx is done.
func (s *Server) ListenAndServe(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.healthz)
	mux.HandleFunc("/headers/latest", s.latest)
	mux.HandleFunc("/headers/", s.headerAt)
	mux.HandleFunc("/merkle-proof", s.merkleProof)
	s.srv = &http.Server{Addr: s.cfg.Addr, Handler: mux}

	ln, err := net.Listen("tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("spv listen %s: %w", s.cfg.Addr, err)
	}
	go func() {
		<-ctx.Done()
		_ = s.srv.Close()
	}()
	s.cfg.Logger.Info("spv service listening", "addr", ln.Addr().String())
	if err := s.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("spv serve: %w", err)
	}
	return nil
}

func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) latest(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tip": s.cache.Tip()})
}

func (s *Server) headerAt(w http.ResponseWriter, r *http.Request) {
	// path is /headers/{height}
	path := r.URL.Path[len("/headers/"):]
	if path == "" || path == "latest" {
		s.latest(w, r)
		return
	}
	height, err := strconv.ParseUint(path, 10, 32)
	if err != nil {
		http.Error(w, "height must be an unsigned integer", http.StatusBadRequest)
		return
	}
	h, err := s.cache.HeaderAt(r.Context(), uint32(height))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, h)
}

func (s *Server) merkleProof(w http.ResponseWriter, r *http.Request) {
	txid := r.URL.Query().Get("txid")
	if txid == "" {
		http.Error(w, "missing ?txid=<64-hex>", http.StatusBadRequest)
		return
	}
	p, err := s.rpc.GetMerkleProof(r.Context(), txid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
