package spv

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// TestHTTPHeightSource_TracksLatest spins up a tiny stub server
// that hosts /headers/latest and proves the HTTPHeightSource
// poll-loop picks up new tip values across two rounds.
func TestHTTPHeightSource_TracksLatest(t *testing.T) {
	var tip atomic.Uint32
	tip.Store(7)
	mux := http.NewServeMux()
	mux.HandleFunc("/headers/latest", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]uint32{"tip": tip.Load()})
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	src := NewHTTPHeightSource(ts.URL, 30*time.Millisecond)
	src.SetInitial(0) // start far below the server's 7

	if err := src.Probe(context.Background()); err != nil {
		t.Fatalf("Probe: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	src.Start(ctx)

	// Wait for the cached tip to converge on 7.
	if !waitFor(t, 2*time.Second, func() bool { return uint32(src.Current()) == 7 }) {
		t.Fatalf("tip did not reach 7 in 2s; got %d", src.Current())
	}

	// Bump the server tip and observe the cache follow.
	tip.Store(99)
	if !waitFor(t, 2*time.Second, func() bool { return uint32(src.Current()) == 99 }) {
		t.Errorf("tip did not reach 99 in 2s; got %d", src.Current())
	}
}

func TestHTTPHeightSource_ProbeFailsOnUnreachable(t *testing.T) {
	src := NewHTTPHeightSource("http://127.0.0.1:1", 50*time.Millisecond)
	if err := src.Probe(context.Background()); err == nil {
		t.Error("Probe to unreachable host should fail")
	}
}

func waitFor(t *testing.T, d time.Duration, predicate func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if predicate() {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}
