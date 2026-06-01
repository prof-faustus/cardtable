package engine

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

const pubA = "02" + "00000000000000000000000000000000000000000000000000000000000000aa"
const pubB = "02" + "00000000000000000000000000000000000000000000000000000000000000bb"

func foldRuleSet() types.RuleSet {
	rs := newRuleSet()
	rs.DeckFormat = 52
	rs.ShuffleAlgorithmVersion = 1
	return rs
}

func makeFoldPlayer(seat int, pubkey string) types.PlayerState {
	return types.PlayerState{
		Seat:                types.Seat(seat),
		PlayerId:            types.PlayerId(pubkey[2:]),
		ValueSigningPubkey:  types.Pubkey33(pubkey),
		ParticipationStatus: types.StatusActive,
		StakeAtRisk:         1000,
		EntropyCommitted:    true,
		EntropyRevealed:     true,
		ConcealedCardRefs:   []types.Outpoint{},
		DefaultPreferences:  map[string]string{},
	}
}

func makeConcealedCard(position int, holder string, state types.CardLifecycleState) types.ConcealedCard {
	return types.ConcealedCard{
		CardCommitment: types.CardCommitment{Position: position, CardCommitment: "aa", CardNonce: "bb"},
		Ciphertext:     "cipher",
		CustodyOutpoint: types.Outpoint("utxo"),
		HolderPubkey:   types.Pubkey33(holder),
		LifecycleState: state,
	}
}

func makeS8FoldState() types.RoundState {
	seat0 := types.Seat(0)
	return types.RoundState{
		StateClass:       types.StateBetDecision,
		GameId:           types.GameId("a"),
		ActingPlayerSeat: &seat0,
		AllowedActions:   GetLegalActions(types.StateBetDecision),
		Players:          []types.PlayerState{makeFoldPlayer(0, pubA), makeFoldPlayer(1, pubB)},
		ConcealedDeck: []types.ConcealedCard{
			makeConcealedCard(0, pubA, types.CardAssignedConcealed),
			makeConcealedCard(1, pubA, types.CardAssignedConcealed),
			makeConcealedCard(2, pubB, types.CardAssignedConcealed),
		},
	}
}

func TestApplyFold_RejectsOnMvpPath(t *testing.T) {
	seat0 := types.Seat(0)
	s := types.RoundState{
		StateClass:       types.StateBetDecision,
		GameId:           types.GameId("a"),
		ActingPlayerSeat: &seat0,
		AllowedActions:   GetLegalActions(types.StateBetDecision),
		Players:          []types.PlayerState{makeFoldPlayer(0, pubA), makeFoldPlayer(1, pubB)},
		// ConcealedDeck deliberately empty.
	}
	action := types.SignedAction{
		GameId:           types.GameId("a"),
		ActionType:       types.ActionFold,
		ActingPlayerSeat: &seat0,
	}
	_, err := ApplyAction(s, action, foldRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidActionForState {
		t.Fatalf("want INVALID_ACTION_FOR_STATE (no concealed deck), got %v", err)
	}
}

func TestApplyFold_TransitionsCardsAndPlayer(t *testing.T) {
	s := makeS8FoldState()
	seat0 := types.Seat(0)
	action := types.SignedAction{
		GameId:           types.GameId("a"),
		ActionType:       types.ActionFold,
		ActingPlayerSeat: &seat0,
	}
	next, err := ApplyAction(s, action, foldRuleSet(), 100)
	if err != nil {
		t.Fatalf("Fold rejected: %v", err)
	}
	if next.StateClass != types.StateRotateTurn {
		t.Errorf("next state class: want RotateTurn, got %s", next.StateClass)
	}
	if next.Players[0].ParticipationStatus != types.StatusFolded {
		t.Errorf("player 0 status: want folded, got %s", next.Players[0].ParticipationStatus)
	}
	if next.Players[1].ParticipationStatus != types.StatusActive {
		t.Errorf("player 1 status: want active, got %s", next.Players[1].ParticipationStatus)
	}
	for i, c := range next.ConcealedDeck {
		if c.HolderPubkey == types.Pubkey33(pubA) {
			if c.LifecycleState != types.CardSurrendered {
				t.Errorf("card %d (pubA): want surrendered, got %s", i, c.LifecycleState)
			}
		} else {
			if c.LifecycleState != types.CardAssignedConcealed {
				t.Errorf("card %d (pubB): want assigned_concealed, got %s", i, c.LifecycleState)
			}
		}
	}
}

func TestApplyFold_PreservesCardCommitmentsAndCiphertexts(t *testing.T) {
	s := makeS8FoldState()
	seat0 := types.Seat(0)
	action := types.SignedAction{
		GameId:           types.GameId("a"),
		ActionType:       types.ActionFold,
		ActingPlayerSeat: &seat0,
	}
	next, err := ApplyAction(s, action, foldRuleSet(), 100)
	if err != nil {
		t.Fatalf("Fold: %v", err)
	}
	for i := range s.ConcealedDeck {
		before := s.ConcealedDeck[i]
		after := next.ConcealedDeck[i]
		if after.Ciphertext != before.Ciphertext {
			t.Errorf("card %d ciphertext mutated", i)
		}
		if after.CustodyOutpoint != before.CustodyOutpoint {
			t.Errorf("card %d custody_outpoint mutated", i)
		}
		if after.HolderPubkey != before.HolderPubkey {
			t.Errorf("card %d holder_pubkey mutated", i)
		}
		if after.CardCommitment != before.CardCommitment {
			t.Errorf("card %d card_commitment mutated", i)
		}
	}
}

func TestApplyFold_RejectsWhenNoAssignedConcealed(t *testing.T) {
	s := makeS8FoldState()
	// Pre-surrender all of seat 0's cards.
	for i := range s.ConcealedDeck {
		if s.ConcealedDeck[i].HolderPubkey == types.Pubkey33(pubA) {
			s.ConcealedDeck[i].LifecycleState = types.CardSurrendered
		}
	}
	seat0 := types.Seat(0)
	action := types.SignedAction{
		GameId:           types.GameId("a"),
		ActionType:       types.ActionFold,
		ActingPlayerSeat: &seat0,
	}
	_, err := ApplyAction(s, action, foldRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidActionForState {
		t.Errorf("want INVALID_ACTION_FOR_STATE, got %v", err)
	}
}
