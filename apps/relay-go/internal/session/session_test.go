package session

import (
	"encoding/hex"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/cryptocards"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

const samplePubkey = "02ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c"

func makeRuleSet() types.RuleSet {
	return types.RuleSet{
		GameType:             types.GameInBetween,
		PlayerCountMin:       2,
		PlayerCountMax:       4,
		StakeAmount:          1000,
		MinBet:               1,
		MaxBet:               100,
		DecisionTimeoutBlocks: 6,
		RecoveryTimeoutBlocks: 144,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
		},
	}
}

func seatPtr(s int) *types.Seat {
	v := types.Seat(s)
	return &v
}

func TestSessionSubmitAdvancesState(t *testing.T) {
	rs := makeRuleSet()
	sess := New(types.GameId("a"), rs, "rh", 144)

	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: seatPtr(0),
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}
	next, perr := sess.Submit(join, 100)
	if perr != nil {
		t.Fatalf("Submit: %v", perr)
	}
	if len(next.Players) != 1 {
		t.Errorf("want 1 player after join, got %d", len(next.Players))
	}
}

func TestSessionRejectsDuplicateNonce(t *testing.T) {
	rs := makeRuleSet()
	sess := New(types.GameId("a"), rs, "rh", 144)

	join := types.SignedAction{
		GameId:           "a",
		ActionType:       types.ActionJoin,
		ActionNonce:      "n1",
		ActingPlayerSeat: seatPtr(0),
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}
	if _, err := sess.Submit(join, 100); err != nil {
		t.Fatalf("first Submit: %v", err)
	}
	join2 := join
	join2.ActingPlayerSeat = seatPtr(1)
	_, err := sess.Submit(join2, 101)
	if err == nil {
		t.Fatal("want STALE_STATE on duplicate nonce, got nil")
	}
	if err.Code != types.ErrStaleState {
		t.Errorf("want STALE_STATE, got %s", err.Code)
	}
}

// TestSessionRejectsForgedEntropyReveal proves the relay's crypto
// gate rejects a reveal whose plaintext does not hash back to the
// committed value. This is the mental-poker integrity property
// brought into the session layer.
func TestSessionRejectsForgedEntropyReveal(t *testing.T) {
	rs := makeRuleSet()
	// game_id, player_id, entropy are all 32-byte hex.
	gameIdHex := "00000000000000000000000000000000000000000000000000000000000000aa"
	playerIdHex := "0101010101010101010101010101010101010101010101010101010101010101"
	pubkeyHex := "02" + playerIdHex // 33-byte compressed pubkey; last 32 bytes ARE the player_id
	entropyHex := "0202020202020202020202020202020202020202020202020202020202020202"

	gameId, _ := hex.DecodeString(gameIdHex)
	playerId, _ := hex.DecodeString(playerIdHex)
	entropy, _ := hex.DecodeString(entropyHex)
	commitment, _ := cryptocards.CommitEntropy(entropy, playerId, gameId)
	commitmentHex := hex.EncodeToString(commitment)

	sess := New(types.GameId(gameIdHex), rs, "rh", 144)

	// 1. Player 0 joins (the pubkey is what verifyCrypto consults).
	seat0 := types.Seat(0)
	join := types.SignedAction{
		GameId:           types.GameId(gameIdHex),
		ActionType:       types.ActionJoin,
		ActionNonce:      "n0",
		ActingPlayerSeat: &seat0,
		PlayerPubkey:     types.Pubkey33(pubkeyHex),
		StakeAmount:      1000,
	}
	if _, err := sess.Submit(join, 100); err != nil {
		t.Fatalf("join 0: %v", err)
	}
	// 2. Player 1 joins so the table can lock with min=2.
	seat1 := types.Seat(1)
	join1 := join
	join1.ActionNonce = "n1"
	join1.ActingPlayerSeat = &seat1
	if _, err := sess.Submit(join1, 100); err != nil {
		t.Fatalf("join 1: %v", err)
	}

	// 3. Lock the table.
	lock := types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTableLock, ActionNonce: "lock"}
	if _, err := sess.Submit(lock, 100); err != nil {
		t.Fatalf("lock: %v", err)
	}

	// 4. Player 0 commits the entropy.
	commit := types.SignedAction{
		GameId:           types.GameId(gameIdHex),
		ActionType:       types.ActionEntropyCommit,
		ActionNonce:      "c0",
		ActingPlayerSeat: &seat0,
		CommitmentHash:   types.Hash256(commitmentHex),
	}
	if _, err := sess.Submit(commit, 100); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// 5. Player 0 attempts a FORGED reveal — different entropy that
	//    does not hash to the prior commitment. MUST be rejected.
	forgedEntropyHex := "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	forged := types.SignedAction{
		GameId:           types.GameId(gameIdHex),
		ActionType:       types.ActionEntropyReveal,
		ActionNonce:      "r0_forged",
		ActingPlayerSeat: &seat0,
		Entropy:          types.Hash256(forgedEntropyHex),
	}
	// Player 1 must commit first for state to be at S4 — but actually
	// in our engine S3 -> S4 needs all seats committed. Let's add a
	// commit for player 1 first using the same commitment (sufficient
	// for the state-machine advance even though the entropy doesn't
	// matter for this test).
	commit1 := commit
	commit1.ActionNonce = "c1"
	commit1.ActingPlayerSeat = &seat1
	if _, err := sess.Submit(commit1, 100); err != nil {
		t.Fatalf("commit 1: %v", err)
	}
	// State should now be S4.
	if got := sess.State().StateClass; got != types.StateEntropyReveal {
		t.Fatalf("want StateEntropyReveal after both commits, got %s", got)
	}

	_, err := sess.Submit(forged, 100)
	if err == nil {
		t.Fatal("forged reveal accepted; want INVALID_REVEAL_PROOF")
	}
	if err.Code != types.ErrInvalidRevealProof {
		t.Errorf("want INVALID_REVEAL_PROOF, got %s", err.Code)
	}

	// 6. Honest reveal of the same entropy MUST be accepted.
	honest := forged
	honest.ActionNonce = "r0_honest"
	honest.Entropy = types.Hash256(entropyHex)
	if _, err := sess.Submit(honest, 100); err != nil {
		t.Errorf("honest reveal rejected: %v", err)
	}
}

func TestSessionReplayReproducesState(t *testing.T) {
	rs := makeRuleSet()
	sess := New(types.GameId("a"), rs, "rh", 144)

	// Two valid joins.
	for i := 0; i < 2; i++ {
		nonce := types.ActionNonce("n0")
		if i == 1 {
			nonce = "n1"
		}
		join := types.SignedAction{
			GameId:           "a",
			ActionType:       types.ActionJoin,
			ActionNonce:      nonce,
			ActingPlayerSeat: seatPtr(i),
			PlayerPubkey:     types.Pubkey33(samplePubkey),
			StakeAmount:      1000,
		}
		if _, err := sess.Submit(join, 100); err != nil {
			t.Fatalf("Submit %d: %v", i, err)
		}
	}

	replayed, perr := sess.Replay("rh", 144)
	if perr != nil {
		t.Fatalf("Replay: %v", perr)
	}
	live := sess.State()
	if len(replayed.Players) != len(live.Players) {
		t.Errorf("replay player count differs: %d vs %d", len(replayed.Players), len(live.Players))
	}
	if replayed.StateClass != live.StateClass {
		t.Errorf("replay state_class differs: %s vs %s", replayed.StateClass, live.StateClass)
	}
}
