package broadcast

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/wire"
)

func TestPublishFansOutToOthers(t *testing.T) {
	h := New(8)
	id1, ch1 := h.Subscribe()
	id2, ch2 := h.Subscribe()
	_, ch3 := h.Subscribe()

	f := wire.Frame{Version: wire.Version1_0, Type: wire.MsgAction, Payload: []byte("hello")}
	delivered, dropped := h.Publish(id1, f)
	if delivered != 2 || dropped != 0 {
		t.Errorf("delivery counts: want delivered=2 dropped=0, got delivered=%d dropped=%d", delivered, dropped)
	}

	if got := drain(ch1); got != 0 {
		t.Errorf("origin subscriber received %d frames, want 0", got)
	}
	if got := drain(ch2); got != 1 {
		t.Errorf("subscriber 2 received %d frames, want 1", got)
	}
	if got := drain(ch3); got != 1 {
		t.Errorf("subscriber 3 received %d frames, want 1", got)
	}

	h.Unsubscribe(id1)
	h.Unsubscribe(id2)
}

func TestUnsubscribeIsIdempotent(t *testing.T) {
	h := New(8)
	id, _ := h.Subscribe()
	h.Unsubscribe(id)
	h.Unsubscribe(id) // should not panic
	if got := h.SubscriberCount(); got != 0 {
		t.Errorf("SubscriberCount after unsubscribe: want 0, got %d", got)
	}
}

func TestPublishDropsWhenQueueFull(t *testing.T) {
	h := New(1)
	_, ch := h.Subscribe()
	f := wire.Frame{Version: wire.Version1_0, Type: wire.MsgPing, Payload: []byte{1}}
	// Fill the queue.
	if d, dr := h.PublishAll(f); d != 1 || dr != 0 {
		t.Fatalf("first publish: want delivered=1 dropped=0, got %d/%d", d, dr)
	}
	// Second publish has no room; should drop.
	if d, dr := h.PublishAll(f); d != 0 || dr != 1 {
		t.Errorf("second publish: want delivered=0 dropped=1, got %d/%d", d, dr)
	}
	_ = ch
}

func drain(ch <-chan wire.Frame) int {
	count := 0
	for {
		select {
		case <-ch:
			count++
		default:
			return count
		}
	}
}
