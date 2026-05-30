// Package broadcast is a fan-out hub for table-scoped frames.
//
// One Hub per table_id. Subscribers receive every frame published
// to the hub except, optionally, frames they themselves submitted
// (via the ExcludeSender filter).
package broadcast

import (
	"sync"

	"github.com/prof-faustus/cardtable/relay-go/pkg/wire"
)

// SubscriberId is an opaque per-connection identifier. Anything
// comparable works; in practice, callers use a random uint64.
type SubscriberId uint64

// Hub is a single-table fan-out. Methods are safe for concurrent use.
type Hub struct {
	mu          sync.Mutex
	nextId      SubscriberId
	subscribers map[SubscriberId]chan wire.Frame
	queueDepth  int
}

// New returns a fresh Hub. queueDepth caps the per-subscriber
// outbound queue; a slow subscriber will start dropping frames once
// its queue is full.
func New(queueDepth int) *Hub {
	if queueDepth <= 0 {
		queueDepth = 64
	}
	return &Hub{
		subscribers: map[SubscriberId]chan wire.Frame{},
		queueDepth:  queueDepth,
	}
}

// Subscribe returns a (id, channel) pair. The caller must call
// Unsubscribe(id) when done; otherwise the channel will be
// garbage-collected only when the hub itself is dropped.
func (h *Hub) Subscribe() (SubscriberId, <-chan wire.Frame) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.nextId++
	id := h.nextId
	ch := make(chan wire.Frame, h.queueDepth)
	h.subscribers[id] = ch
	return id, ch
}

// Unsubscribe closes the subscriber's channel and removes it from
// the hub. It is safe to call multiple times.
func (h *Hub) Unsubscribe(id SubscriberId) {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch, ok := h.subscribers[id]
	if !ok {
		return
	}
	close(ch)
	delete(h.subscribers, id)
}

// Publish fans out a frame to every subscriber except `from`. A
// subscriber whose outbound queue is full will silently drop the
// frame; the relay's QoS is at-most-once.
func (h *Hub) Publish(from SubscriberId, f wire.Frame) (delivered, dropped int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for id, ch := range h.subscribers {
		if id == from {
			continue
		}
		select {
		case ch <- f:
			delivered++
		default:
			dropped++
		}
	}
	return delivered, dropped
}

// PublishAll fans out a frame to every subscriber including any
// "from" filter (e.g. for server-originated TABLE_STATE messages).
func (h *Hub) PublishAll(f wire.Frame) (delivered, dropped int) {
	return h.Publish(0, f)
}

// SendTo delivers a frame to a single subscriber by id. Returns
// true if delivered, false if the subscriber is unknown or its
// queue is full.
func (h *Hub) SendTo(id SubscriberId, f wire.Frame) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch, ok := h.subscribers[id]
	if !ok {
		return false
	}
	select {
	case ch <- f:
		return true
	default:
		return false
	}
}

// SubscriberCount returns the number of active subscribers.
func (h *Hub) SubscriberCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subscribers)
}
