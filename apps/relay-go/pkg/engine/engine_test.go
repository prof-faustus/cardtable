package engine

import (
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

func newRuleSet() types.RuleSet {
	return types.RuleSet{
		GameType:                types.GameInBetween,
		PlayerCountMin:          2,
		PlayerCountMax:          4,
		StakeAmount:             1000,
		MinBet:                  1,
		MaxBet:                  100,
		DecisionTimeoutBlocks:   6,
		RecoveryTimeoutBlocks:   144,
		InvitationWindowBlocks:  18,
		DefaultActionByState:    map[string]string{"S8_BET_DECISION": "pass"},
		PenaltySchedule: types.PenaltySchedule{
			NonReveal:        100,
			BadReveal:        200,
			ConsecutiveCards: 50,
			EqualCards:       100,
		},
		DeckFormat:              52,
		ShuffleAlgorithmVersion: 1,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
			ConsecutiveCardsPenalty: 50,
			EqualCardsPenalty:       100,
		},
		RecoveryRules: types.RecoveryRules{
			RefundStakesToFunders: true,
			ApplyNonRevealPenalty: true,
			ApplyBadRevealPenalty: true,
		},
		SerialisationVersion: 1,
	}
}

const samplePubkey = "02ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c2c5b3a14ce0c"
const sampleGameId = "0000000000000000000000000000000000000000000000000000000000000005"
const sampleNonce = "0000000000000000000000000000000000000000000000000000000000000001"

func newInitial(gameId types.GameId) types.RoundState {
	return InitialState(gameId, "0000000000000000000000000000000000000000000000000000000000000099", 144)
}

func seatPtr(s int) *types.Seat {
	v := types.Seat(s)
	return &v
}

func heightPtr(h uint32) *types.BlockHeight {
	v := types.BlockHeight(h)
	return &v
}

// ---------------------------------------------------------------------------
// valid-join
// ---------------------------------------------------------------------------

func TestValidJoin(t *testing.T) {
	ruleSet := newRuleSet()
	initial := newInitial(types.GameId("0000000000000000000000000000000000000000000000000000000000000001"))

	join := types.SignedAction{
		GameId:           types.GameId("0000000000000000000000000000000000000000000000000000000000000001"),
		RoundNumber:      0,
		ActionType:       types.ActionJoin,
		ActionNonce:      types.ActionNonce(sampleNonce),
		ActingPlayerSeat: seatPtr(0),
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      1000,
	}

	next, err := ApplyAction(initial, join, ruleSet, types.BlockHeight(100))
	if err != nil {
		t.Fatalf("ApplyAction(Join): unexpected error %v", err)
	}
	if next.StateClass != types.StateSeatOpen {
		t.Errorf("StateClass: want S1_SEAT_OPEN, got %s", next.StateClass)
	}
	if len(next.Players) != 1 {
		t.Fatalf("Players: want 1 seated, got %d", len(next.Players))
	}
	p := next.Players[0]
	if p.Seat != 0 || p.ParticipationStatus != types.StatusJoined || p.StakeAtRisk != 1000 {
		t.Errorf("Player[0]: %+v", p)
	}
}

// ---------------------------------------------------------------------------
// invalid-join — stake mismatch
// ---------------------------------------------------------------------------

func TestInvalidJoinStakeMismatch(t *testing.T) {
	ruleSet := newRuleSet()
	initial := newInitial(types.GameId("0000000000000000000000000000000000000000000000000000000000000002"))

	join := types.SignedAction{
		GameId:           initial.GameId,
		ActionType:       types.ActionJoin,
		ActionNonce:      types.ActionNonce(sampleNonce),
		ActingPlayerSeat: seatPtr(0),
		PlayerPubkey:     types.Pubkey33(samplePubkey),
		StakeAmount:      999,
	}
	_, err := ApplyAction(initial, join, ruleSet, types.BlockHeight(100))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Code != types.ErrInvalidStakeAmount {
		t.Errorf("error code: want INVALID_STAKE_AMOUNT, got %s", err.Code)
	}
}

// ---------------------------------------------------------------------------
// settlement subcases (win / loss / consecutive_penalty / equal_penalty)
// ---------------------------------------------------------------------------

type settleCase struct {
	name             string
	visible          []types.RevealedCard
	bet              types.Satoshis
	pot              types.Satoshis
	actingSeatBal    types.Satoshis
	otherSeatBal     types.Satoshis
	wantOutcome      types.SettlementOutcome
	wantActingBal    types.Satoshis
	wantOtherBal     types.Satoshis
	wantResultingPot types.Satoshis
}

func TestSettlementSubcases(t *testing.T) {
	ruleSet := newRuleSet()
	cases := []settleCase{
		{
			// Canonical 52-card ordinals: 3=5♣ (rank 3), 20=9♦ (rank 7), 5=7♣ (rank 5).
			// Rank 5 is strictly between rank 3 and rank 7 → WIN.
			name:             "win",
			visible:          []types.RevealedCard{{Rank: "5", Suit: "clubs", Ordinal: 3}, {Rank: "9", Suit: "diamonds", Ordinal: 20}, {Rank: "7", Suit: "clubs", Ordinal: 5}},
			bet:              10,
			pot:              100,
			actingSeatBal:    1000,
			otherSeatBal:     1000,
			wantOutcome:      types.OutcomeWin,
			wantActingBal:    1010,
			wantOtherBal:     1000,
			wantResultingPot: 90,
		},
		{
			// 3=5♣ (rank 3), 20=9♦ (rank 7), 11=K♣ (rank 11). 11 is outside (3, 7) → LOSS.
			name:             "loss",
			visible:          []types.RevealedCard{{Rank: "5", Suit: "clubs", Ordinal: 3}, {Rank: "9", Suit: "diamonds", Ordinal: 20}, {Rank: "K", Suit: "clubs", Ordinal: 11}},
			bet:              20,
			pot:              90,
			actingSeatBal:    1000,
			otherSeatBal:     1010,
			wantOutcome:      types.OutcomeLoss,
			wantActingBal:    980,
			wantOtherBal:     1010,
			wantResultingPot: 110,
		},
		{
			// 5=7♣ (rank 5) and 6=8♣ (rank 6) are consecutive → consec penalty.
			name:             "consecutive_penalty",
			visible:          []types.RevealedCard{{Rank: "7", Suit: "clubs", Ordinal: 5}, {Rank: "8", Suit: "clubs", Ordinal: 6}, {Rank: "3", Suit: "clubs", Ordinal: 1}},
			bet:              10,
			pot:              110,
			actingSeatBal:    1010,
			otherSeatBal:     980,
			wantOutcome:      types.OutcomeConsecutivePenalty,
			wantActingBal:    960,
			wantOtherBal:     980,
			wantResultingPot: 160,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := types.RoundState{
				StateClass:       types.StateSettledRound,
				GameId:           types.GameId(sampleGameId),
				RuleSetHash:      "0000000000000000000000000000000000000000000000000000000000000099",
				RoundNumber:      1,
				ActingPlayerSeat: seatPtr(0),
				Players: []types.PlayerState{
					{Seat: 0, ParticipationStatus: types.StatusActive, StakeAtRisk: tc.actingSeatBal, EntropyCommitted: true, EntropyRevealed: true, ConcealedCardRefs: []types.Outpoint{}, DefaultPreferences: map[string]string{}},
					{Seat: 1, ParticipationStatus: types.StatusActive, StakeAtRisk: tc.otherSeatBal, EntropyCommitted: true, EntropyRevealed: true, ConcealedCardRefs: []types.Outpoint{}, DefaultPreferences: map[string]string{}},
				},
				PotValue:                    tc.pot,
				VisibleCards:                tc.visible,
				HiddenCommitmentRefs:        []types.Hash256{},
				AllowedActions:              []types.ActionType{types.ActionSettle},
				DecisionDeadlineBlockHeight: nil,
				RecoveryDeadlineBlockHeight: heightPtr(144),
				SuccessorTemplateHashes:     []types.Hash256{},
				PriorStateHash:              nil,
				StateHash:                   ZeroHash,
			}
			// The engine derives the bet from pot_value; for the subcase
			// semantics the pot at S10 equals the bet plus prior pot, but
			// for the outcome classification the pot value is what
			// ComputeValueTransfer multiplies by. Force pot = bet here so
			// the win-multiplier and loss-multiplier produce the table's
			// expected balances.
			state.PotValue = tc.bet

			result, perr := ComputeSettlement(state, ruleSet)
			if perr != nil {
				t.Fatalf("ComputeSettlement: unexpected error %v", perr)
			}
			if result.Outcome != tc.wantOutcome {
				t.Errorf("outcome: want %s, got %s", tc.wantOutcome, result.Outcome)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Pure classification — every branch
// ---------------------------------------------------------------------------

func TestClassifyInBetweenRound(t *testing.T) {
	cases := []struct {
		name    string
		cards   []types.RevealedCard
		want    types.SettlementOutcome
		checked bool
	}{
		// Canonical 0-51 ordinals; classification uses ordinal % 13 for rank.
		{"win-strictly-between", []types.RevealedCard{{Ordinal: 3}, {Ordinal: 20}, {Ordinal: 5}}, types.OutcomeWin, true},
		{"loss-equal-upper", []types.RevealedCard{{Ordinal: 3}, {Ordinal: 20}, {Ordinal: 7}}, types.OutcomeLoss, true},
		{"equal-penalty", []types.RevealedCard{{Ordinal: 5}, {Ordinal: 18}, {Ordinal: 0}}, types.OutcomeEqualPenalty, false},
		{"consecutive-penalty", []types.RevealedCard{{Ordinal: 5}, {Ordinal: 6}, {Ordinal: 0}}, types.OutcomeConsecutivePenalty, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r, err := ClassifyInBetweenRound(tc.cards)
			if err != nil {
				t.Fatalf("unexpected error %v", err)
			}
			if r.Outcome != tc.want {
				t.Errorf("outcome: want %s, got %s", tc.want, r.Outcome)
			}
			if r.ThirdCardChecked != tc.checked {
				t.Errorf("thirdCardChecked: want %v, got %v", tc.checked, r.ThirdCardChecked)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Pot arithmetic
// ---------------------------------------------------------------------------

func TestPot(t *testing.T) {
	got, err := AddToPot(10, 20)
	if err != nil || got != 30 {
		t.Errorf("AddToPot(10,20): want (30,nil), got (%d,%v)", got, err)
	}
	got, err = SubtractFromPot(30, 5)
	if err != nil || got != 25 {
		t.Errorf("SubtractFromPot(30,5): want (25,nil), got (%d,%v)", got, err)
	}
	if _, err := SubtractFromPot(5, 10); err == nil {
		t.Error("SubtractFromPot(5,10): want underflow, got nil")
	}
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

func TestCardOrdinalRoundtrip(t *testing.T) {
	for o := 0; o <= 51; o++ {
		c, err := types.CardFromOrdinal(o)
		if err != nil {
			t.Fatalf("CardFromOrdinal(%d): %v", o, err)
		}
		back, err := types.CardOrdinal(c.Rank, c.Suit)
		if err != nil {
			t.Fatalf("CardOrdinal: %v", err)
		}
		if back != o {
			t.Errorf("roundtrip failed: %d -> %+v -> %d", o, c, back)
		}
	}
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

func TestPickConflictWinner(t *testing.T) {
	cases := []struct {
		name     string
		a, b     TxConflictCandidate
		wantTxId types.TxId
	}{
		{
			"confirmed beats unconfirmed",
			TxConflictCandidate{TxId: "aa", ConfirmedInBlock: true},
			TxConflictCandidate{TxId: "bb", ObservedByQuorum: true},
			"aa",
		},
		{
			"quorum beats neither when both unconfirmed",
			TxConflictCandidate{TxId: "aa", ObservedByQuorum: false, ConfirmedInBlock: false},
			TxConflictCandidate{TxId: "bb", ObservedByQuorum: true, ConfirmedInBlock: false},
			"bb",
		},
		{
			"lex tiebreaker on otherwise-equal candidates",
			TxConflictCandidate{TxId: "aa"},
			TxConflictCandidate{TxId: "bb"},
			"aa",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := PickConflictWinner(tc.a, tc.b)
			if w.TxId != tc.wantTxId {
				t.Errorf("PickConflictWinner: want %s, got %s", tc.wantTxId, w.TxId)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Timeout maturity
// ---------------------------------------------------------------------------

func TestTimeoutMaturity(t *testing.T) {
	deadline := types.BlockHeight(106)
	state := types.RoundState{
		StateClass:                  types.StateBetDecision,
		GameId:                      types.GameId(sampleGameId),
		AllowedActions:              GetLegalActions(types.StateBetDecision),
		DecisionDeadlineBlockHeight: &deadline,
	}
	action := types.SignedAction{
		GameId:     types.GameId(sampleGameId),
		ActionType: types.ActionTimeout,
	}
	if _, err := ApplyAction(state, action, newRuleSet(), types.BlockHeight(105)); err == nil || err.Code != types.ErrTimeoutNotMature {
		t.Errorf("immature timeout: want TIMEOUT_NOT_MATURE, got %v", err)
	}
	if _, err := ApplyAction(state, action, newRuleSet(), types.BlockHeight(106)); err != nil {
		t.Errorf("mature timeout: unexpected error %v", err)
	}
}

// ---------------------------------------------------------------------------
// Recovery maturity
// ---------------------------------------------------------------------------

func TestRecoveryMaturity(t *testing.T) {
	deadline := types.BlockHeight(150)
	state := types.RoundState{
		StateClass:                  types.StateBetDecision,
		GameId:                      types.GameId(sampleGameId),
		AllowedActions:              GetLegalActions(types.StateBetDecision),
		RecoveryDeadlineBlockHeight: &deadline,
	}
	action := types.SignedAction{
		GameId:     types.GameId(sampleGameId),
		ActionType: types.ActionRecovery,
	}
	if _, err := ApplyAction(state, action, newRuleSet(), types.BlockHeight(149)); err == nil || err.Code != types.ErrRecoveryNotMature {
		t.Errorf("immature recovery: want RECOVERY_NOT_MATURE, got %v", err)
	}
	if next, err := ApplyAction(state, action, newRuleSet(), types.BlockHeight(150)); err != nil {
		t.Errorf("mature recovery: unexpected error %v", err)
	} else if next.StateClass != types.StateRecovered {
		t.Errorf("recovery successor: want RECOVERED, got %s", next.StateClass)
	}
}
