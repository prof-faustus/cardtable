package spv

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// rpcMux runs a tiny HTTP server that speaks the subset of Bitcoin
// Core JSON-RPC the production RPCClient calls. Each handler returns
// a canned response keyed by the request's `method`.
type rpcMux struct {
	responses map[string]json.RawMessage
}

func (m *rpcMux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	var req struct {
		Method string `json:"method"`
		ID     uint64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	body, ok := m.responses[req.Method]
	if !ok {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":     req.ID,
			"result": nil,
			"error":  map[string]any{"code": -32601, "message": "method not found"},
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"id":     req.ID,
		"result": body,
		"error":  nil,
	})
}

func TestRPCClient_GetBestBlockHeight(t *testing.T) {
	mux := &rpcMux{responses: map[string]json.RawMessage{
		"getblockcount": json.RawMessage(`12345`),
	}}
	ts := httptest.NewServer(mux)
	defer ts.Close()

	c := NewRPCClient(ts.URL, "u", "p")
	h, err := c.GetBestBlockHeight(context.Background())
	if err != nil {
		t.Fatalf("GetBestBlockHeight: %v", err)
	}
	if h != 12345 {
		t.Errorf("height: want 12345, got %d", h)
	}
}

func TestRPCClient_GetBlockHeaderByHeight(t *testing.T) {
	mux := &rpcMux{responses: map[string]json.RawMessage{
		"getblockhash":    json.RawMessage(`"0000abcd"`),
		"getblockheader":  json.RawMessage(`{"hash":"0000abcd","previousblockhash":"0000aaaa","merkleroot":"deadbeef","time":1700000000,"bits":"1d00ffff","nonce":42,"version":1,"height":99}`),
	}}
	ts := httptest.NewServer(mux)
	defer ts.Close()

	c := NewRPCClient(ts.URL, "u", "p")
	h, err := c.GetBlockHeaderByHeight(context.Background(), 99)
	if err != nil {
		t.Fatalf("GetBlockHeaderByHeight: %v", err)
	}
	if h.Height != 99 {
		t.Errorf("height: want 99, got %d", h.Height)
	}
	if h.Hash != "0000abcd" {
		t.Errorf("hash: want 0000abcd, got %s", h.Hash)
	}
	if h.MerkleRoot != "deadbeef" {
		t.Errorf("merkle_root: want deadbeef, got %s", h.MerkleRoot)
	}
	if h.Time != 1700000000 {
		t.Errorf("time: want 1700000000, got %d", h.Time)
	}
	if h.Bits != 0x1d00ffff {
		t.Errorf("bits: want 0x1d00ffff, got 0x%x", h.Bits)
	}
}

func TestRPCClient_GetMerkleProof(t *testing.T) {
	mux := &rpcMux{responses: map[string]json.RawMessage{
		"getmerkleproof": json.RawMessage(`{"target":"aabb","nodes":["sib1","sib2"],"index":3,"blockhash":"bh","blockheight":77}`),
	}}
	ts := httptest.NewServer(mux)
	defer ts.Close()

	c := NewRPCClient(ts.URL, "u", "p")
	p, err := c.GetMerkleProof(context.Background(), "aabb")
	if err != nil {
		t.Fatalf("GetMerkleProof: %v", err)
	}
	if p.TxId != "aabb" || p.Index != 3 || len(p.Siblings) != 2 {
		t.Errorf("proof: %+v", p)
	}
}

func TestRPCClient_PropagatesRPCError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":     1,
			"result": nil,
			"error":  map[string]any{"code": -1, "message": "boom"},
		})
	}))
	defer ts.Close()
	c := NewRPCClient(ts.URL, "u", "p")
	if _, err := c.GetBestBlockHeight(context.Background()); err == nil {
		t.Error("want rpc error, got nil")
	}
}
