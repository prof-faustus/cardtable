package adversarial

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Scenario 10: Duplicate message propagation. Re-submitting an action
// whose nonce was already accepted is idempotent — the second submit is
// rejected with STALE_STATE and the canonical state is unchanged.
func TestScenario10_DuplicateMessageIsIdempotent(t *testing.T) {
	sess := newSession()
	join := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: "dup",
		ActingPlayerSeat: seatPtr(0), PlayerPubkey: types.Pubkey33(pubkeys[0]), StakeAmount: 1000,
	}
	if _, err := sess.Submit(join, 100); err != nil {
		t.Fatalf("first submit rejected: %v", err)
	}
	before := sess.State()
	_, err := sess.Submit(join, 100) // duplicate
	if err == nil || err.Code != types.ErrStaleState {
		t.Errorf("scenario 10: duplicate want STALE_STATE, got %v", err)
	}
	after := sess.State()
	if len(before.Players) != len(after.Players) {
		t.Errorf("scenario 10: duplicate mutated state (%d -> %d players)", len(before.Players), len(after.Players))
	}
}

// Scenario 9: Reconnect with obsolete state. A client that fell behind
// replays an already-applied action; the relay rejects the stale replay
// (STALE_STATE) so the client knows to resync rather than double-apply.
func TestScenario09_ReconnectWithObsoleteStateRejected(t *testing.T) {
	sess := newSession()
	first := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: "a",
		ActingPlayerSeat: seatPtr(0), PlayerPubkey: types.Pubkey33(pubkeys[0]), StakeAmount: 1000,
	}
	second := types.SignedAction{
		GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: "b",
		ActingPlayerSeat: seatPtr(1), PlayerPubkey: types.Pubkey33(pubkeys[1]), StakeAmount: 1000,
	}
	if _, err := sess.Submit(first, 100); err != nil {
		t.Fatalf("first: %v", err)
	}
	if _, err := sess.Submit(second, 100); err != nil {
		t.Fatalf("second: %v", err)
	}
	// Obsolete reconnect: replay the very first (already-applied) action.
	_, err := sess.Submit(first, 100)
	if err == nil || err.Code != types.ErrStaleState {
		t.Errorf("scenario 9: obsolete replay want STALE_STATE, got %v", err)
	}
	if got := sess.State().StateClass; got != types.StateSeatOpen {
		t.Errorf("scenario 9: state should be unchanged S1, got %s", got)
	}
}
