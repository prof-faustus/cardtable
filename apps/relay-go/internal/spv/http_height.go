package spv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// HTTPHeightSource polls an external SPV service's /headers/latest
// endpoint and caches the tip. The relay binary uses this when
// --spv-url is set instead of the static --start-height fallback.
//
// Thread-safe; the cached height is exposed via Current.
type HTTPHeightSource struct {
	base     string
	interval time.Duration
	httpc    *http.Client
	tip      atomic.Uint32
}

// NewHTTPHeightSource configures a poller. `base` is the SPV
// service base URL (e.g. http://localhost:8082). `interval` is the
// poll cadence; zero defaults to 5s.
func NewHTTPHeightSource(base string, interval time.Duration) *HTTPHeightSource {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return &HTTPHeightSource{
		base:     base,
		interval: interval,
		httpc:    &http.Client{Timeout: 5 * time.Second},
	}
}

// SetInitial seeds the cached tip — useful so the first
// CurrentHeight calls don't return 0 before the first poll lands.
func (s *HTTPHeightSource) SetInitial(h uint32) { s.tip.Store(h) }

// Current returns the latest cached tip.
func (s *HTTPHeightSource) Current() types.BlockHeight {
	return types.BlockHeight(s.tip.Load())
}

// Start kicks off the background poll loop; returns when ctx is done.
func (s *HTTPHeightSource) Start(ctx context.Context) {
	go func() {
		s.refresh(ctx)
		t := time.NewTicker(s.interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.refresh(ctx)
			}
		}
	}()
}

func (s *HTTPHeightSource) refresh(ctx context.Context) {
	url := s.base + "/headers/latest"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return
	}
	resp, err := s.httpc.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return
	}
	var body struct {
		Tip uint32 `json:"tip"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return
	}
	s.tip.Store(body.Tip)
}

// ErrSpvUnavailable is returned by Probe when the SPV endpoint is
// not reachable. Callers can fall back to a static height.
var ErrSpvUnavailable = errors.New("spv: /headers/latest unreachable")

// Probe issues a single synchronous request to confirm the SPV
// endpoint is reachable; returns ErrSpvUnavailable on any failure.
// Used by the relay's startup to fail fast if --spv-url is wrong.
func (s *HTTPHeightSource) Probe(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.base+"/healthz", nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSpvUnavailable, err)
	}
	resp, err := s.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSpvUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%w: status %d", ErrSpvUnavailable, resp.StatusCode)
	}
	return nil
}
