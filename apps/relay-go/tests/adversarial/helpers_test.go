// Package adversarial holds the named adversarial-scenario suite for
// PROJECT_SPEC.md §783 (the 14 mandatory scenarios). It lives inside the
// relay-go module so it can drive the real internal/session layer plus
// the pure engine, mirroring packages/state-engine/__tests__/
// adversarial-scenarios.test.ts on the Go side.
//
// Scenarios that depend on the on-chain layer (double-spend conflict
// resolution at the chain level, mempool eviction, reorg) are exercised
// deterministically against a programmable fake chain in the
// chain_scenarios_test.go file — no live BSV node required.
package adversarial

import (
	"encoding/hex"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/internal/session"
	"github.com/prof-faustus/cardtable/relay-go/pkg/cryptocards"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

const gameIdHex = "00000000000000000000000000000000000000000000000000000000000000aa"

var (
	playerIds = []string{
		"0101010101010101010101010101010101010101010101010101010101010101",
		"0303030303030303030303030303030303030303030303030303030303030303",
	}
	pubkeys = []string{"02" + playerIds[0], "02" + playerIds[1]}
	entropies = []string{
		"0202020202020202020202020202020202020202020202020202020202020202",
		"0404040404040404040404040404040404040404040404040404040404040404",
	}
)

func ruleSet() types.RuleSet {
	return types.RuleSet{
		GameType:              types.GameInBetween,
		PlayerCountMin:        2,
		PlayerCountMax:        4,
		StakeAmount:           1000,
		MinBet:                1,
		MaxBet:                100,
		DecisionTimeoutBlocks: 6,
		RecoveryTimeoutBlocks: 144,
		DeckFormat:            52,
		ShuffleAlgorithmVersion: 1,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
		},
	}
}

func mustDecode(t *testing.T, h string) []byte {
	t.Helper()
	b, err := hex.DecodeString(h)
	if err != nil {
		t.Fatalf("hex decode %q: %v", h, err)
	}
	return b
}

func seatPtr(i int) *types.Seat {
	s := types.Seat(i)
	return &s
}

func bh(h int) *types.BlockHeight {
	v := types.BlockHeight(h)
	return &v
}

// commitmentHexFor computes the canonical entropy commitment for a seat.
func commitmentHexFor(t *testing.T, seat int) string {
	t.Helper()
	c, err := cryptocards.CommitEntropy(mustDecode(t, entropies[seat]), mustDecode(t, playerIds[seat]), mustDecode(t, gameIdHex))
	if err != nil {
		t.Fatalf("CommitEntropy seat %d: %v", seat, err)
	}
	return hex.EncodeToString(c)
}

// newSession returns a fresh S1 session for the standard 2-player table.
func newSession() *session.Session {
	return session.New(types.GameId(gameIdHex), ruleSet(), "rh", 144)
}

// driveToBetDecision drives a real session through Join×2 → Lock →
// Commit×2 → Reveal×2 → CardReveal×2, landing at S8_BET_DECISION with a
// fully materialised deck commitment. Every step is submitted through
// the production crypto gate, so the resulting session is genuine.
func driveToBetDecision(t *testing.T) *session.Session {
	t.Helper()
	sess := newSession()
	rs := ruleSet()

	submit := func(a types.SignedAction) {
		t.Helper()
		if _, err := sess.Submit(a, 100); err != nil {
			t.Fatalf("driveToBetDecision: %s rejected: %v", a.ActionType, err)
		}
	}

	for i := 0; i < 2; i++ {
		submit(types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionJoin, ActionNonce: types.ActionNonce("join" + string(rune('0'+i))),
			ActingPlayerSeat: seatPtr(i), PlayerPubkey: types.Pubkey33(pubkeys[i]), StakeAmount: 1000,
		})
	}
	submit(types.SignedAction{GameId: types.GameId(gameIdHex), ActionType: types.ActionTableLock, ActionNonce: "lock"})
	for i := 0; i < 2; i++ {
		submit(types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionEntropyCommit, ActionNonce: types.ActionNonce("commit" + string(rune('0'+i))),
			ActingPlayerSeat: seatPtr(i), CommitmentHash: types.Hash256(commitmentHexFor(t, i)),
		})
	}
	for i := 0; i < 2; i++ {
		submit(types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionEntropyReveal, ActionNonce: types.ActionNonce("reveal" + string(rune('0'+i))),
			ActingPlayerSeat: seatPtr(i), Entropy: types.Hash256(entropies[i]),
		})
	}
	if got := sess.State().StateClass; got != types.StateDeckCommitted {
		t.Fatalf("driveToBetDecision: expected S5 after reveals, got %s", got)
	}

	combined, err := cryptocards.CombineEntropy([][]byte{mustDecode(t, entropies[0]), mustDecode(t, entropies[1])})
	if err != nil {
		t.Fatalf("CombineEntropy: %v", err)
	}
	dc, err := cryptocards.BuildDeckCommitment(combined, rs.DeckFormat, rs.ShuffleAlgorithmVersion)
	if err != nil {
		t.Fatalf("BuildDeckCommitment: %v", err)
	}
	cardReveal := func(pos int, nonce string) types.SignedAction {
		p := dc.PerPosition[pos]
		return types.SignedAction{
			GameId: types.GameId(gameIdHex), ActionType: types.ActionCardReveal, ActionNonce: types.ActionNonce(nonce),
			Reveal: types.RevealProof{
				Position:     p.Position,
				RevealedCard: types.RevealedCard{Rank: "2", Suit: "clubs", Ordinal: p.Ordinal},
				CardNonce:    types.Hash256(hex.EncodeToString(p.CardNonce)),
				DeckNonce:    types.Hash256(hex.EncodeToString(p.DeckNonce)),
			},
		}
	}
	submit(cardReveal(0, "card0"))
	submit(cardReveal(1, "card1"))
	if got := sess.State().StateClass; got != types.StateBetDecision {
		t.Fatalf("driveToBetDecision: expected S8, got %s", got)
	}
	return sess
}

// betDecisionState builds a synthetic S8 state literal with a decision
// deadline — for timeout-maturity scenarios where we need to control the
// deadline directly (the engine does not stamp one on the S7→S8 edge).
func betDecisionState(deadline int) types.RoundState {
	return types.RoundState{
		StateClass:                  types.StateBetDecision,
		GameId:                      types.GameId(gameIdHex),
		ActingPlayerSeat:            seatPtr(0),
		Players:                     []types.PlayerState{{Seat: 0, StakeAtRisk: 1000}, {Seat: 1, StakeAtRisk: 1000}},
		AllowedActions:              []types.ActionType{types.ActionBet, types.ActionPass, types.ActionTimeout, types.ActionFold},
		DecisionDeadlineBlockHeight: bh(deadline),
		RecoveryDeadlineBlockHeight: bh(244),
	}
}
