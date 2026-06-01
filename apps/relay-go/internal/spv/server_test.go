package spv

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func newTestServer(t *testing.T, rpc BsvRPC) (*httptest.Server, *HeaderCache) {
	t.Helper()
	cache := NewHeaderCache(rpc, 50*time.Millisecond)
	cache.Start(context.Background())
	t.Cleanup(cache.Stop)
	srv := NewServer(ServerConfig{Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}, cache, rpc)
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", srv.healthz)
	mux.HandleFunc("/headers/latest", srv.latest)
	mux.HandleFunc("/headers/", srv.headerAt)
	mux.HandleFunc("/merkle-proof", srv.merkleProof)
	return httptest.NewServer(mux), cache
}

func TestHealthz(t *testing.T) {
	rpc := &FakeRPC{BestHeight: 100}
	ts, _ := newTestServer(t, rpc)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("get /healthz: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("healthz status: want 200, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "ok" {
		t.Errorf("healthz body: want 'ok', got %q", body)
	}
}

func TestLatestTipReflectsCacheRefresh(t *testing.T) {
	rpc := &FakeRPC{BestHeight: 123}
	ts, cache := newTestServer(t, rpc)
	defer ts.Close()

	// Wait for the cache to refresh from the RPC at least once.
	deadline := time.Now().Add(2 * time.Second)
	for cache.Tip() == 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := http.Get(ts.URL + "/headers/latest")
	if err != nil {
		t.Fatalf("get latest: %v", err)
	}
	defer resp.Body.Close()
	var body struct {
		Tip uint32 `json:"tip"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode latest: %v", err)
	}
	if body.Tip != 123 {
		t.Errorf("tip: want 123, got %d", body.Tip)
	}
}

func TestHeaderAt(t *testing.T) {
	rpc := &FakeRPC{
		BestHeight: 100,
		Headers: map[uint32]BlockHeader{
			42: {Height: 42, Hash: "ab", PreviousHash: "cd", MerkleRoot: "ef", Time: 1, Bits: 2, Nonce: 3, Version: 1},
		},
	}
	ts, _ := newTestServer(t, rpc)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/headers/42")
	if err != nil {
		t.Fatalf("get header 42: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status: want 200, got %d", resp.StatusCode)
	}
	var h BlockHeader
	if err := json.NewDecoder(resp.Body).Decode(&h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h.Height != 42 || h.Hash != "ab" {
		t.Errorf("header mismatch: %+v", h)
	}
}

func TestMerkleProof(t *testing.T) {
	rpc := &FakeRPC{
		Proofs: map[string]MerkleProof{
			"aa": {TxId: "aa", BlockHash: "bb", BlockHeight: 99, Index: 7, Siblings: []string{"cc", "dd"}},
		},
	}
	ts, _ := newTestServer(t, rpc)
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/merkle-proof?txid=aa")
	if err != nil {
		t.Fatalf("get proof: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var p MerkleProof
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if p.Index != 7 || len(p.Siblings) != 2 {
		t.Errorf("proof mismatch: %+v", p)
	}
}

func TestMerkleProofMissingTxIdReturns400(t *testing.T) {
	ts, _ := newTestServer(t, &FakeRPC{})
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/merkle-proof")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("want 400, got %d", resp.StatusCode)
	}
}
