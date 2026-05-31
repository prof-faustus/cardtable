package session

import (
	"encoding/hex"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/cryptocards"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Adversarial scenarios — named attack/mitigation pairs at the Go
// session layer. Mirrors packages/state-engine/__tests__/
// adversarial-scenarios.test.ts. Each test exercises one specific
// attack and asserts the expected rejection.

func adversarialRuleSet() types.RuleSet {
	rs := makeRuleSet()
	rs.DeckFormat = 52
	rs.ShuffleAlgorithmVersion = 1
	return rs
}

const advGameIdHex = "00000000000000000000000000000000000000000000000000000000000000aa"

var (
	advPlayerIds = []string{
		"0101010101010101010101010101010101010101010101010101010101010101",
		"0303030303030303030303030303030303030303030303030303030303030303",
	}
	advPubkeys = []string{
		"02" + "0101010101010101010101010101010101010101010101010101010101010101",
		"02" + "0303030303030303030303030303030303030303030303030303030303030303",
	}
	advEntropies = []string{
		"0202020202020202020202020202020202020202020202020202020202020202",
		"0404040404040404040404040404040404040404040404040404040404040404",
	}
)

func TestAdvA01_JoinWithWrongStake(t *testing.T) {
	sess := New(types.GameId(advGameIdHex), adversarialRuleSet(), "rh", 144)
	seat0 := types.Seat(0)
	bad := types.SignedAction{
		GameId:           types.GameId(advGameIdHex),
		ActionType:       types.ActionJoin,
		ActionNonce:      "01",
		ActingPlayerSeat: &seat0,
		PlayerPubkey:     types.Pubkey33(advPubkeys[0]),
		StakeAmount:      999, // ruleSet wants 1000
	}
	_, err := sess.Submit(bad, 100)
	if err == nil || err.Code != types.ErrInvalidStakeAmount {
		t.Errorf("A01: want INVALID_STAKE_AMOUNT, got %v", err)
	}
}

func TestAdvA03_ForgedEntropyRevealRejected(t *testing.T) {
	sess := New(types.GameId(advGameIdHex), adversarialRuleSet(), "rh", 144)

	gameId, _ := hex.DecodeString(advGameIdHex)
	c0Bytes, _ := cryptocards.CommitEntropy(decodeOrPanic(advEntropies[0]), decodeOrPanic(advPlayerIds[0]), gameId)
	c1Bytes, _ := cryptocards.CommitEntropy(decodeOrPanic(advEntropies[1]), decodeOrPanic(advPlayerIds[1]), gameId)
	c0Hex, c1Hex := hex.EncodeToString(c0Bytes), hex.EncodeToString(c1Bytes)

	seat0, seat1 := types.Seat(0), types.Seat(1)
	mustSubmit(t, sess, types.SignedAction{
		GameId: types.GameId(advGameIdHex), ActionType: types.ActionJoin, ActionNonce: "10",
		ActingPlayerSeat: &seat0, PlayerPubkey: types.Pubkey33(advPubkeys[0]), StakeAmount: 1000,
	})
	mustSubmit(t, sess, types.SignedAction{
		GameId: types.GameId(advGameIdHex), ActionType: types.ActionJoin, ActionNonce: "11",
		ActingPlayerSeat: &seat1, PlayerPubkey: types.Pubkey33(advPubkeys[1]), StakeAmount: 1000,
	})
	mustSubmit(t, sess, types.SignedAction{
		GameId: types.GameId(advGameIdHex), ActionType: types.ActionTableLock, ActionNonce: "12",
	})
	mustSubmit(t, sess, types.SignedAction{
		GameId: types.GameId(advGameIdHex), ActionType: types.ActionEntropyCommit, ActionNonce: "20",
		ActingPlayerSeat: &seat0, CommitmentHash: types.Hash256(c0Hex),
	})
	mustSubmit(t, sess, types.SignedAction{
		GameId: types.GameId(advGameIdHex), ActionType: types.ActionEntropyCommit, ActionNonce: "21",
		ActingPlayerSeat: &seat1, CommitmentHash: types.Hash256(c1Hex),
	})

	forged := types.SignedAction{
		GameId: types.GameId(advGameIdHex), ActionType: types.ActionEntropyReveal, ActionNonce: "30",
		ActingPlayerSeat: &seat0,
		Entropy:          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	}
	_, err := sess.Submit(forged, 100)
	if err == nil || err.Code != types.ErrInvalidRevealProof {
		t.Errorf("A03: want INVALID_REVEAL_PROOF, got %v", err)
	}
}

func TestAdvA07_DuplicateNonceRejected(t *testing.T) {
	sess := New(types.GameId(advGameIdHex), adversarialRuleSet(), "rh", 144)
	seat0 := types.Seat(0)
	join := types.SignedAction{
		GameId:           types.GameId(advGameIdHex),
		ActionType:       types.ActionJoin,
		ActionNonce:      "abc",
		ActingPlayerSeat: &seat0,
		PlayerPubkey:     types.Pubkey33(advPubkeys[0]),
		StakeAmount:      1000,
	}
	mustSubmit(t, sess, join)
	// Re-submit the same nonce with seat 1 (also legal otherwise).
	seat1 := types.Seat(1)
	dup := join
	dup.ActingPlayerSeat = &seat1
	dup.PlayerPubkey = types.Pubkey33(advPubkeys[1])
	_, err := sess.Submit(dup, 100)
	if err == nil || err.Code != types.ErrStaleState {
		t.Errorf("A07: want STALE_STATE on replay, got %v", err)
	}
}

func TestAdvA10_DoubleSeatRejected(t *testing.T) {
	sess := New(types.GameId(advGameIdHex), adversarialRuleSet(), "rh", 144)
	seat0 := types.Seat(0)
	join := types.SignedAction{
		GameId:           types.GameId(advGameIdHex),
		ActionType:       types.ActionJoin,
		ActionNonce:      "01",
		ActingPlayerSeat: &seat0,
		PlayerPubkey:     types.Pubkey33(advPubkeys[0]),
		StakeAmount:      1000,
	}
	mustSubmit(t, sess, join)
	join2 := join
	join2.ActionNonce = "02" // dedup is not the issue we're testing
	_, err := sess.Submit(join2, 100)
	if err == nil || err.Code != types.ErrPlayerAlreadySeated {
		t.Errorf("A10: want PLAYER_ALREADY_SEATED, got %v", err)
	}
}

func mustSubmit(t *testing.T, s *Session, a types.SignedAction) {
	t.Helper()
	if _, err := s.Submit(a, 100); err != nil {
		t.Fatalf("Submit %s: %v", a.ActionType, err)
	}
}

func decodeOrPanic(h string) []byte {
	b, err := hex.DecodeString(h)
	if err != nil {
		panic(err)
	}
	return b
}
