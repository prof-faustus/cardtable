package engine

import (
	"fmt"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

func dealRuleSet() types.RuleSet {
	rs := newRuleSet()
	rs.DeckFormat = 52
	rs.ShuffleAlgorithmVersion = 1
	return rs
}

func dealStateS5() types.RoundState {
	seat0 := types.Seat(0)
	return types.RoundState{
		StateClass:       types.StateDeckCommitted,
		GameId:           types.GameId("a"),
		ActingPlayerSeat: &seat0,
		AllowedActions:   GetLegalActions(types.StateDeckCommitted),
		Players:          []types.PlayerState{makeFoldPlayer(0, pubA)},
	}
}

func makeFullDeck(n int) []types.ConcealedCard {
	out := make([]types.ConcealedCard, n)
	for i := 0; i < n; i++ {
		out[i] = types.ConcealedCard{
			CardCommitment: types.CardCommitment{Position: i, CardCommitment: types.Hash256(fmt.Sprintf("%02x", i)), CardNonce: "bb"},
			Ciphertext:     "cipher",
			CustodyOutpoint: types.Outpoint("utxo"),
			HolderPubkey:   types.Pubkey33(pubA),
			LifecycleState: types.CardAssignedConcealed,
		}
	}
	return out
}

func TestApplyDealConcealed_OK(t *testing.T) {
	s := dealStateS5()
	rs := dealRuleSet()
	action := types.SignedAction{
		GameId:         types.GameId("a"),
		ActionType:     types.ActionDealConcealed,
		ConcealedCards: makeFullDeck(52),
	}
	next, err := ApplyAction(s, action, rs, 100)
	if err != nil {
		t.Fatalf("DealConcealed: %v", err)
	}
	if next.StateClass != types.StateDeckCommitted {
		t.Errorf("state_class: want StateDeckCommitted, got %s", next.StateClass)
	}
	if len(next.ConcealedDeck) != 52 {
		t.Errorf("ConcealedDeck length: want 52, got %d", len(next.ConcealedDeck))
	}
}

func TestApplyDealConcealed_RejectsOutsideS5(t *testing.T) {
	s := dealStateS5()
	s.StateClass = types.StateBetDecision
	s.AllowedActions = GetLegalActions(types.StateBetDecision)
	action := types.SignedAction{
		GameId:         types.GameId("a"),
		ActionType:     types.ActionDealConcealed,
		ConcealedCards: makeFullDeck(52),
	}
	_, err := ApplyAction(s, action, dealRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidActionForState {
		t.Errorf("want INVALID_ACTION_FOR_STATE, got %v", err)
	}
}

func TestApplyDealConcealed_RejectsSecondDeal(t *testing.T) {
	s := dealStateS5()
	s.ConcealedDeck = makeFullDeck(1)
	action := types.SignedAction{
		GameId:         types.GameId("a"),
		ActionType:     types.ActionDealConcealed,
		ConcealedCards: makeFullDeck(52),
	}
	_, err := ApplyAction(s, action, dealRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidStateTransition {
		t.Errorf("want INVALID_STATE_TRANSITION, got %v", err)
	}
}

func TestApplyDealConcealed_RejectsWrongCount(t *testing.T) {
	action := types.SignedAction{
		GameId:         types.GameId("a"),
		ActionType:     types.ActionDealConcealed,
		ConcealedCards: makeFullDeck(51), // one short
	}
	_, err := ApplyAction(dealStateS5(), action, dealRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidStateTransition {
		t.Errorf("want INVALID_STATE_TRANSITION on wrong count, got %v", err)
	}
}

func TestApplyDealConcealed_RejectsDuplicatePosition(t *testing.T) {
	cards := makeFullDeck(52)
	cards[10].CardCommitment.Position = 11 // duplicate of position 11
	action := types.SignedAction{
		GameId:         types.GameId("a"),
		ActionType:     types.ActionDealConcealed,
		ConcealedCards: cards,
	}
	_, err := ApplyAction(dealStateS5(), action, dealRuleSet(), 100)
	if err == nil || err.Code != types.ErrInvalidStateTransition {
		t.Errorf("want INVALID_STATE_TRANSITION on duplicate position, got %v", err)
	}
}
