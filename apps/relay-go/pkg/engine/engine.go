package engine

import (
	"fmt"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// ZeroHash is the all-zero state hash used when a state has no
// canonical pre-image yet (e.g. the initial state of a session).
const ZeroHash types.Hash256 = "0000000000000000000000000000000000000000000000000000000000000000"

// InitialState returns the fresh starting state of a session at
// S1_SEAT_OPEN with no players seated.
func InitialState(gameId types.GameId, ruleSetHash types.RuleSetHash, recoveryDeadline types.BlockHeight) types.RoundState {
	return types.RoundState{
		StateClass:                  types.StateSeatOpen,
		GameId:                      gameId,
		RuleSetHash:                 ruleSetHash,
		RoundNumber:                 types.RoundNumber(0),
		ActingPlayerSeat:            nil,
		Players:                     []types.PlayerState{},
		PotValue:                    types.Satoshis(0),
		VisibleCards:                []types.RevealedCard{},
		HiddenCommitmentRefs:        []types.Hash256{},
		AllowedActions:              []types.ActionType{types.ActionJoin, types.ActionTableLock},
		DecisionDeadlineBlockHeight: nil,
		RecoveryDeadlineBlockHeight: &recoveryDeadline,
		SuccessorTemplateHashes:     []types.Hash256{},
		PriorStateHash:              nil,
		StateHash:                   ZeroHash,
	}
}

// GetLegalActions returns the canonical action set for a state class.
func GetLegalActions(sc types.StateClass) []types.ActionType {
	switch sc {
	case types.StateTableOpen:
		return []types.ActionType{}
	case types.StateSeatOpen:
		return []types.ActionType{types.ActionJoin, types.ActionTableLock}
	case types.StateTableLocked:
		return []types.ActionType{types.ActionEntropyCommit}
	case types.StateEntropyCommit:
		return []types.ActionType{types.ActionEntropyCommit}
	case types.StateEntropyReveal:
		return []types.ActionType{types.ActionEntropyReveal}
	case types.StateDeckCommitted:
		return []types.ActionType{types.ActionCardReveal}
	case types.StateCardRevealFirst:
		return []types.ActionType{types.ActionCardReveal}
	case types.StateCardRevealSecond:
		return []types.ActionType{types.ActionBet, types.ActionPass, types.ActionTimeout}
	case types.StateBetDecision:
		return []types.ActionType{types.ActionBet, types.ActionPass, types.ActionTimeout}
	case types.StateCardRevealThird:
		return []types.ActionType{types.ActionCardReveal}
	case types.StateSettledRound:
		return []types.ActionType{types.ActionSettle}
	case types.StateRotateTurn:
		return []types.ActionType{types.ActionRotateTurn}
	case types.StateTableClose:
		return []types.ActionType{types.ActionTableClose}
	case types.StateRecovered:
		return []types.ActionType{}
	default:
		return []types.ActionType{}
	}
}

// ApplyAction is the canonical pure transition function. Returns the
// successor state or a typed ProtocolError; never panics.
func ApplyAction(state types.RoundState, action types.SignedAction, ruleSet types.RuleSet, currentHeight types.BlockHeight) (types.RoundState, *types.ProtocolError) {
	if action.GameId != state.GameId {
		return state, types.NewProtocolError(types.ErrStaleState, "action.game_id mismatch")
	}
	// Recovery is a global outcome; it bypasses the per-state allowed-action
	// list and is gated only by the recovery deadline (checked in applyRecovery).
	if action.ActionType != types.ActionRecovery {
		legal := GetLegalActions(state.StateClass)
		if !containsAction(legal, action.ActionType) {
			return state, types.NewProtocolError(types.ErrInvalidActionForState,
				fmt.Sprintf("%s not legal at %s", action.ActionType, state.StateClass))
		}
	}
	switch action.ActionType {
	case types.ActionJoin:
		return applyJoin(state, action, ruleSet)
	case types.ActionTableLock:
		return applyTableLock(state, action, ruleSet)
	case types.ActionEntropyCommit:
		return applyEntropyCommit(state, action)
	case types.ActionEntropyReveal:
		return applyEntropyReveal(state, action)
	case types.ActionCardReveal:
		return applyCardReveal(state, action)
	case types.ActionBet:
		return applyBet(state, action, ruleSet)
	case types.ActionPass:
		return applyPass(state)
	case types.ActionFold:
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "Fold reserved for Phase 4+")
	case types.ActionSettle:
		return applySettle(state, ruleSet)
	case types.ActionRotateTurn:
		return applyRotateTurn(state)
	case types.ActionTableClose:
		return applyTableClose(state)
	case types.ActionTimeout:
		return applyTimeout(state, currentHeight)
	case types.ActionRecovery:
		return applyRecovery(state, currentHeight)
	default:
		return state, types.NewProtocolError(types.ErrInvalidActionForState,
			fmt.Sprintf("unknown action %s", action.ActionType))
	}
}

func containsAction(list []types.ActionType, a types.ActionType) bool {
	for _, x := range list {
		if x == a {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Per-action handlers
// ---------------------------------------------------------------------------

func applyJoin(state types.RoundState, action types.SignedAction, ruleSet types.RuleSet) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateSeatOpen {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "Join outside S1")
	}
	if action.StakeAmount != ruleSet.StakeAmount {
		return state, types.NewProtocolError(types.ErrInvalidStakeAmount,
			fmt.Sprintf("expected %d, got %d", ruleSet.StakeAmount, action.StakeAmount))
	}
	if len(state.Players) >= ruleSet.PlayerCountMax {
		return state, types.NewProtocolError(types.ErrTableFull,
			fmt.Sprintf("max %d seats", ruleSet.PlayerCountMax))
	}
	var seat types.Seat
	if action.ActingPlayerSeat != nil {
		seat = *action.ActingPlayerSeat
	} else {
		seat = types.Seat(len(state.Players))
	}
	for _, p := range state.Players {
		if p.Seat == seat {
			return state, types.NewProtocolError(types.ErrPlayerAlreadySeated,
				fmt.Sprintf("seat %d taken", seat))
		}
	}
	next := cloneState(state)
	next.Players = append(next.Players, types.PlayerState{
		Seat:                seat,
		PlayerId:            types.PlayerId(action.PlayerPubkey),
		ValueSigningPubkey:  action.PlayerPubkey,
		ParticipationStatus: types.StatusJoined,
		StakeAtRisk:         action.StakeAmount,
		EntropyCommitted:    false,
		EntropyRevealed:     false,
		ConcealedCardRefs:   []types.Outpoint{},
		DefaultPreferences:  map[string]string{},
	})
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyTableLock(state types.RoundState, _ types.SignedAction, ruleSet types.RuleSet) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateSeatOpen {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "TableLock outside S1")
	}
	if len(state.Players) < ruleSet.PlayerCountMin {
		return state, types.NewProtocolError(types.ErrTableNotLockable,
			fmt.Sprintf("need %d seats, have %d", ruleSet.PlayerCountMin, len(state.Players)))
	}
	next := cloneState(state)
	next.StateClass = types.StateEntropyCommit
	next.AllowedActions = GetLegalActions(types.StateEntropyCommit)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyEntropyCommit(state types.RoundState, action types.SignedAction) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateEntropyCommit {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "EntropyCommit outside S3")
	}
	if action.ActingPlayerSeat == nil {
		return state, types.NewProtocolError(types.ErrSeatOutOfRange, "EntropyCommit requires acting_player_seat")
	}
	seat := *action.ActingPlayerSeat
	idx := findSeat(state.Players, seat)
	if idx < 0 {
		return state, types.NewProtocolError(types.ErrPlayerNotSeated, fmt.Sprintf("seat %d", seat))
	}
	if state.Players[idx].EntropyCommitted {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, "seat already committed")
	}
	next := cloneState(state)
	next.Players = cloneSeats(state.Players)
	next.Players[idx].EntropyCommitted = true
	allCommitted := true
	for _, p := range next.Players {
		if !p.EntropyCommitted {
			allCommitted = false
			break
		}
	}
	if allCommitted {
		next.StateClass = types.StateEntropyReveal
	} else {
		next.StateClass = types.StateEntropyCommit
	}
	next.AllowedActions = GetLegalActions(next.StateClass)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyEntropyReveal(state types.RoundState, action types.SignedAction) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateEntropyReveal {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "EntropyReveal outside S4")
	}
	if action.ActingPlayerSeat == nil {
		return state, types.NewProtocolError(types.ErrSeatOutOfRange, "EntropyReveal requires acting_player_seat")
	}
	seat := *action.ActingPlayerSeat
	idx := findSeat(state.Players, seat)
	if idx < 0 {
		return state, types.NewProtocolError(types.ErrPlayerNotSeated, fmt.Sprintf("seat %d", seat))
	}
	if !state.Players[idx].EntropyCommitted {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, "seat must commit before reveal")
	}
	if state.Players[idx].EntropyRevealed {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, "seat already revealed")
	}
	next := cloneState(state)
	next.Players = cloneSeats(state.Players)
	next.Players[idx].EntropyRevealed = true
	next.Players[idx].ParticipationStatus = types.StatusActive
	allRevealed := true
	for _, p := range next.Players {
		if !p.EntropyRevealed {
			allRevealed = false
			break
		}
	}
	if allRevealed {
		next.StateClass = types.StateDeckCommitted
	} else {
		next.StateClass = types.StateEntropyReveal
	}
	next.AllowedActions = GetLegalActions(next.StateClass)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyCardReveal(state types.RoundState, action types.SignedAction) (types.RoundState, *types.ProtocolError) {
	var nextClass types.StateClass
	switch state.StateClass {
	case types.StateDeckCommitted:
		nextClass = types.StateCardRevealFirst
	case types.StateCardRevealFirst:
		nextClass = types.StateCardRevealSecond
	case types.StateCardRevealThird:
		nextClass = types.StateSettledRound
	default:
		return state, types.NewProtocolError(types.ErrInvalidActionForState,
			fmt.Sprintf("CardReveal at %s", state.StateClass))
	}
	finalClass := nextClass
	actingSeat := state.ActingPlayerSeat
	if nextClass == types.StateCardRevealSecond {
		finalClass = types.StateBetDecision
		if actingSeat == nil && len(state.Players) > 0 {
			s := state.Players[0].Seat
			actingSeat = &s
		}
	}
	next := cloneState(state)
	next.StateClass = finalClass
	next.VisibleCards = append(append([]types.RevealedCard{}, state.VisibleCards...), action.Reveal.RevealedCard)
	next.ActingPlayerSeat = actingSeat
	next.AllowedActions = GetLegalActions(finalClass)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyBet(state types.RoundState, action types.SignedAction, ruleSet types.RuleSet) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateBetDecision {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "BetAction outside S8")
	}
	if action.BetAmount < ruleSet.MinBet || action.BetAmount > ruleSet.MaxBet {
		return state, types.NewProtocolError(types.ErrInvalidBetAmount,
			fmt.Sprintf("bet %d not in [%d, %d]", action.BetAmount, ruleSet.MinBet, ruleSet.MaxBet))
	}
	pot, err := AddToPot(state.PotValue, action.BetAmount)
	if err != nil {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	next := cloneState(state)
	next.StateClass = types.StateCardRevealThird
	next.PotValue = pot
	next.AllowedActions = GetLegalActions(types.StateCardRevealThird)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyPass(state types.RoundState) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateBetDecision {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "Pass outside S8")
	}
	next := cloneState(state)
	next.StateClass = types.StateRotateTurn
	next.AllowedActions = GetLegalActions(types.StateRotateTurn)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applySettle(state types.RoundState, ruleSet types.RuleSet) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateSettledRound {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "Settle outside S10")
	}
	if len(state.VisibleCards) != 3 {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition,
			fmt.Sprintf("settle requires 3 visible cards, have %d", len(state.VisibleCards)))
	}
	if state.ActingPlayerSeat == nil {
		return state, types.NewProtocolError(types.ErrSeatOutOfRange, "settle requires an acting_player_seat")
	}
	bet := state.PotValue
	cls, err := ClassifyInBetweenRound(state.VisibleCards)
	if err != nil {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	vt, err := ComputeValueTransfer(cls.Outcome, bet, ruleSet.SettlementRules)
	if err != nil {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	newPot := int64(state.PotValue) + vt.PotDelta
	if newPot < 0 {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, "settlement produces negative pot")
	}
	players := cloneSeats(state.Players)
	for i := range players {
		if players[i].Seat != *state.ActingPlayerSeat {
			continue
		}
		nextBal := int64(players[i].StakeAtRisk) + vt.PlayerDelta
		if nextBal < 0 {
			return state, types.NewProtocolError(types.ErrInvalidStateTransition, "settlement produces negative balance")
		}
		players[i].StakeAtRisk = types.Satoshis(nextBal)
	}
	next := cloneState(state)
	next.StateClass = types.StateRotateTurn
	next.PotValue = types.Satoshis(newPot)
	next.Players = players
	next.AllowedActions = GetLegalActions(types.StateRotateTurn)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyRotateTurn(state types.RoundState) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateRotateTurn {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "RotateTurn outside S11")
	}
	seats := make([]types.Seat, 0, len(state.Players))
	for _, p := range state.Players {
		seats = append(seats, p.Seat)
	}
	if len(seats) == 0 {
		return state, types.NewProtocolError(types.ErrTableNotLockable, "no players to rotate")
	}
	sortSeats(seats)
	var nextSeat types.Seat
	wrapped := false
	if state.ActingPlayerSeat == nil {
		nextSeat = seats[0]
	} else {
		i := indexOfSeat(seats, *state.ActingPlayerSeat)
		nextSeat = seats[(i+1)%len(seats)]
		if nextSeat == seats[0] {
			wrapped = true
		}
	}
	next := cloneState(state)
	hash := state.StateHash
	next.PriorStateHash = &hash
	if wrapped {
		next.StateClass = types.StateTableClose
		next.AllowedActions = GetLegalActions(types.StateTableClose)
		return next, nil
	}
	next.StateClass = types.StateCardRevealFirst
	next.RoundNumber = state.RoundNumber + 1
	next.ActingPlayerSeat = &nextSeat
	next.VisibleCards = []types.RevealedCard{}
	next.AllowedActions = GetLegalActions(types.StateCardRevealFirst)
	return next, nil
}

func applyTableClose(state types.RoundState) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateTableClose {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "TableClose outside S12")
	}
	next := cloneState(state)
	next.AllowedActions = []types.ActionType{}
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyTimeout(state types.RoundState, currentHeight types.BlockHeight) (types.RoundState, *types.ProtocolError) {
	if state.StateClass != types.StateBetDecision {
		return state, types.NewProtocolError(types.ErrInvalidActionForState, "Timeout only legal at S8 in v1")
	}
	if state.DecisionDeadlineBlockHeight == nil {
		return state, types.NewProtocolError(types.ErrTimeoutNotMature, "no decision deadline")
	}
	if currentHeight < *state.DecisionDeadlineBlockHeight {
		return state, types.NewProtocolError(types.ErrTimeoutNotMature,
			fmt.Sprintf("current=%d, deadline=%d", currentHeight, *state.DecisionDeadlineBlockHeight))
	}
	next := cloneState(state)
	next.StateClass = types.StateRotateTurn
	next.AllowedActions = GetLegalActions(types.StateRotateTurn)
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

func applyRecovery(state types.RoundState, currentHeight types.BlockHeight) (types.RoundState, *types.ProtocolError) {
	if state.RecoveryDeadlineBlockHeight == nil {
		return state, types.NewProtocolError(types.ErrRecoveryNotMature, "no recovery deadline")
	}
	if currentHeight < *state.RecoveryDeadlineBlockHeight {
		return state, types.NewProtocolError(types.ErrRecoveryNotMature,
			fmt.Sprintf("current=%d, recovery=%d", currentHeight, *state.RecoveryDeadlineBlockHeight))
	}
	next := cloneState(state)
	next.StateClass = types.StateRecovered
	next.AllowedActions = []types.ActionType{}
	hash := state.StateHash
	next.PriorStateHash = &hash
	return next, nil
}

// ---------------------------------------------------------------------------
// ComputeSettlement (read-only)
// ---------------------------------------------------------------------------

// ComputeSettlement returns the SettlementResult that ApplyAction(Settle)
// would produce, without mutating state. Useful for clients.
func ComputeSettlement(state types.RoundState, ruleSet types.RuleSet) (types.SettlementResult, *types.ProtocolError) {
	if state.StateClass != types.StateSettledRound {
		return types.SettlementResult{}, types.NewProtocolError(types.ErrInvalidActionForState, "computeSettlement requires S10 state")
	}
	if len(state.VisibleCards) != 3 || state.ActingPlayerSeat == nil {
		return types.SettlementResult{}, types.NewProtocolError(types.ErrInvalidStateTransition, "incomplete S10")
	}
	bet := state.PotValue
	cls, err := ClassifyInBetweenRound(state.VisibleCards)
	if err != nil {
		return types.SettlementResult{}, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	vt, err := ComputeValueTransfer(cls.Outcome, bet, ruleSet.SettlementRules)
	if err != nil {
		return types.SettlementResult{}, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	balances := make([]types.Satoshis, 0, len(state.Players))
	for _, p := range state.Players {
		if p.Seat == *state.ActingPlayerSeat {
			nextBal := int64(p.StakeAtRisk) + vt.PlayerDelta
			if nextBal < 0 {
				nextBal = 0
			}
			balances = append(balances, types.Satoshis(nextBal))
		} else {
			balances = append(balances, p.StakeAtRisk)
		}
	}
	resultingPot := int64(state.PotValue) + vt.PotDelta
	if resultingPot < 0 {
		resultingPot = 0
	}
	absDelta := vt.PlayerDelta
	if absDelta < 0 {
		absDelta = -absDelta
	}
	return types.SettlementResult{
		RoundStateHash:    state.StateHash,
		Outcome:           cls.Outcome,
		BetAmount:         bet,
		ActingPlayerSeat:  *state.ActingPlayerSeat,
		AmountWonOrLost:   types.Satoshis(absDelta),
		ResultingPotValue: types.Satoshis(resultingPot),
		ResultingBalances: balances,
	}, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func cloneState(s types.RoundState) types.RoundState {
	out := s
	out.Players = append([]types.PlayerState(nil), s.Players...)
	out.VisibleCards = append([]types.RevealedCard(nil), s.VisibleCards...)
	out.HiddenCommitmentRefs = append([]types.Hash256(nil), s.HiddenCommitmentRefs...)
	out.AllowedActions = append([]types.ActionType(nil), s.AllowedActions...)
	out.SuccessorTemplateHashes = append([]types.Hash256(nil), s.SuccessorTemplateHashes...)
	return out
}

func cloneSeats(in []types.PlayerState) []types.PlayerState {
	out := make([]types.PlayerState, len(in))
	for i, p := range in {
		copy := p
		copy.ConcealedCardRefs = append([]types.Outpoint(nil), p.ConcealedCardRefs...)
		if p.DefaultPreferences != nil {
			m := make(map[string]string, len(p.DefaultPreferences))
			for k, v := range p.DefaultPreferences {
				m[k] = v
			}
			copy.DefaultPreferences = m
		}
		out[i] = copy
	}
	return out
}

func findSeat(players []types.PlayerState, s types.Seat) int {
	for i, p := range players {
		if p.Seat == s {
			return i
		}
	}
	return -1
}

func sortSeats(s []types.Seat) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}

func indexOfSeat(s []types.Seat, x types.Seat) int {
	for i, v := range s {
		if v == x {
			return i
		}
	}
	return -1
}
