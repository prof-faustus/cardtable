package spv

import (
	"context"
	"sync"
	"time"
)

// HeaderCache is a small in-memory cache of block headers. It polls
// the BSV node on a configurable interval; the relay's
// CurrentHeight callback reads from here without blocking on RPC.
type HeaderCache struct {
	rpc      BsvRPC
	interval time.Duration

	mu     sync.RWMutex
	tip    uint32
	heads  map[uint32]BlockHeader
	stopCh chan struct{}
}

// NewHeaderCache constructs a cache that polls `rpc` every
// `interval` (zero defaults to 5 seconds).
func NewHeaderCache(rpc BsvRPC, interval time.Duration) *HeaderCache {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	return &HeaderCache{
		rpc:      rpc,
		interval: interval,
		heads:    map[uint32]BlockHeader{},
		stopCh:   make(chan struct{}),
	}
}

// Start kicks off the background poll loop. Call Stop to tear down.
func (c *HeaderCache) Start(ctx context.Context) {
	go c.loop(ctx)
}

// Stop terminates the poll loop. Idempotent.
func (c *HeaderCache) Stop() {
	select {
	case <-c.stopCh:
	default:
		close(c.stopCh)
	}
}

func (c *HeaderCache) loop(ctx context.Context) {
	// Poll immediately, then on the interval.
	c.refresh(ctx)
	t := time.NewTicker(c.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		case <-t.C:
			c.refresh(ctx)
		}
	}
}

func (c *HeaderCache) refresh(ctx context.Context) {
	h, err := c.rpc.GetBestBlockHeight(ctx)
	if err != nil {
		return
	}
	c.mu.Lock()
	c.tip = h
	c.mu.Unlock()
}

// Tip returns the cached chain-tip height. Zero before the first
// refresh; callers should not block on this — the relay's
// CurrentHeight callback uses whatever value is current and accepts
// some lag.
func (c *HeaderCache) Tip() uint32 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.tip
}

// HeaderAt returns a cached header at the given height, fetching
// from the RPC on miss and caching the result.
func (c *HeaderCache) HeaderAt(ctx context.Context, height uint32) (BlockHeader, error) {
	c.mu.RLock()
	if h, ok := c.heads[height]; ok {
		c.mu.RUnlock()
		return h, nil
	}
	c.mu.RUnlock()

	h, err := c.rpc.GetBlockHeaderByHeight(ctx, height)
	if err != nil {
		return BlockHeader{}, err
	}
	c.mu.Lock()
	c.heads[height] = h
	c.mu.Unlock()
	return h, nil
}
