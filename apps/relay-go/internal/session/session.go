// Package session holds the per-game runtime state. A Session wraps
// the pure engine state with the bits a relay needs that the engine
// deliberately omits: action nonce dedup, the audit transcript, and
// the latest accepted state hash.
package session

import (
	"encoding/hex"
	"fmt"
	"sync"

	"github.com/prof-faustus/cardtable/relay-go/pkg/cryptocards"
	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Session is one active game. Methods are safe for concurrent use.
type Session struct {
	mu sync.Mutex

	gameId      types.GameId
	ruleSet     types.RuleSet
	state       types.RoundState
	seenNonces  map[types.ActionNonce]struct{}
	transcript  []types.SignedAction
	heights     []types.BlockHeight
}

// New constructs a new Session with an initial S1 state.
func New(gameId types.GameId, ruleSet types.RuleSet, ruleSetHash types.RuleSetHash, recoveryDeadline types.BlockHeight) *Session {
	return &Session{
		gameId:     gameId,
		ruleSet:    ruleSet,
		state:      engine.InitialState(gameId, ruleSetHash, recoveryDeadline),
		seenNonces: map[types.ActionNonce]struct{}{},
	}
}

// State returns a snapshot of the current round state. The returned
// value shares slice memory with the session; callers must not
// mutate it.
func (s *Session) State() types.RoundState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

// Submit applies a signed action with replay protection AND
// cryptographic verification of any commit/reveal action. If the
// action nonce has been seen before, the call is rejected with
// STALE_STATE. If a reveal action does not hash back to its prior
// commitment, the call is rejected with INVALID_REVEAL_PROOF. On
// success the engine is consulted, the deck commitment is
// materialised at the S4 -> S5 transition, and the action is
// appended to the transcript.
func (s *Session) Submit(action types.SignedAction, height types.BlockHeight) (types.RoundState, *types.ProtocolError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.seenNonces[action.ActionNonce]; ok {
		return s.state, types.NewProtocolError(types.ErrStaleState, "action nonce already accepted")
	}
	if perr := s.verifyCrypto(action); perr != nil {
		return s.state, perr
	}
	priorClass := s.state.StateClass
	next, err := engine.ApplyAction(s.state, action, s.ruleSet, height)
	if err != nil {
		return s.state, err
	}
	if priorClass == types.StateEntropyReveal && next.StateClass == types.StateDeckCommitted && next.CombinedEntropy == "" {
		patched, perr := s.materialiseDeckCommitment(next)
		if perr != nil {
			return s.state, perr
		}
		next = patched
	}
	s.seenNonces[action.ActionNonce] = struct{}{}
	s.transcript = append(s.transcript, action)
	s.heights = append(s.heights, height)
	s.state = next
	return next, nil
}

// materialiseDeckCommitment derives combined_entropy + deck_commitment_hash
// from the players' revealed entropies and stamps them onto the new
// state.
func (s *Session) materialiseDeckCommitment(state types.RoundState) (types.RoundState, *types.ProtocolError) {
	seated := append([]types.PlayerState{}, state.Players...)
	// Sort by seat ascending (canonical ordering).
	for i := 1; i < len(seated); i++ {
		for j := i; j > 0 && seated[j-1].Seat > seated[j].Seat; j-- {
			seated[j-1], seated[j] = seated[j], seated[j-1]
		}
	}
	entropies := make([][]byte, 0, len(seated))
	for _, p := range seated {
		if p.EntropyValue == "" {
			return state, types.NewProtocolError(types.ErrInvalidStateTransition, "missing entropy_value at S5")
		}
		e, err := hex.DecodeString(string(p.EntropyValue))
		if err != nil || len(e) != 32 {
			return state, types.NewProtocolError(types.ErrSerialisation, "entropy_value not 32-byte hex")
		}
		entropies = append(entropies, e)
	}
	combined, err := cryptocards.CombineEntropy(entropies)
	if err != nil {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	dc, err := cryptocards.BuildDeckCommitment(combined, s.ruleSet.DeckFormat, s.ruleSet.ShuffleAlgorithmVersion)
	if err != nil {
		return state, types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
	}
	state.CombinedEntropy = types.Hash256(hex.EncodeToString(combined))
	state.DeckCommitmentHash = types.Hash256(hex.EncodeToString(dc.DeckCommitmentHash))
	return state, nil
}

// verifyCrypto enforces the mental-poker preconditions on commit /
// reveal / card-reveal actions. The pure engine remains
// crypto-agnostic; this verifier is the gate that rejects forged
// reveals before any state transition is computed.
func (s *Session) verifyCrypto(a types.SignedAction) *types.ProtocolError {
	switch a.ActionType {
	case types.ActionEntropyCommit:
		// Just check the commitment is the right shape — no semantic
		// check is possible until the reveal lands.
		if _, err := hex.DecodeString(string(a.CommitmentHash)); err != nil || len(a.CommitmentHash) != 64 {
			return types.NewProtocolError(types.ErrInvalidSignature, "commitment_hash must be 64-char hex")
		}

	case types.ActionEntropyReveal:
		if a.ActingPlayerSeat == nil {
			return types.NewProtocolError(types.ErrSeatOutOfRange, "EntropyReveal requires acting_player_seat")
		}
		var stored types.Hash256
		var pubkey types.Pubkey33
		for _, p := range s.state.Players {
			if p.Seat == *a.ActingPlayerSeat {
				stored = p.EntropyCommitmentHash
				pubkey = p.ValueSigningPubkey
				break
			}
		}
		if stored == "" {
			return types.NewProtocolError(types.ErrInvalidStateTransition, "no prior commitment for this seat")
		}
		commitmentBytes, err := hex.DecodeString(string(stored))
		if err != nil {
			return types.NewProtocolError(types.ErrSerialisation, "stored commitment is not valid hex")
		}
		entropyBytes, err := hex.DecodeString(string(a.Entropy))
		if err != nil || len(entropyBytes) != 32 {
			return types.NewProtocolError(types.ErrInvalidRevealProof, "entropy must be 32-byte hex")
		}
		playerIdBytes, err := hex.DecodeString(string(pubkey))
		if err != nil || len(playerIdBytes) < 32 {
			return types.NewProtocolError(types.ErrSerialisation, "player pubkey not hex-decodable")
		}
		// The protocol's player_id (per spec/card-protocol.md §3) is a
		// 32-byte identifier; for the reference impl we take the
		// last 32 bytes of the 33-byte compressed pubkey to fit the
		// bytes32 input.
		playerIdBytes = playerIdBytes[len(playerIdBytes)-32:]
		gameIdBytes, err := hex.DecodeString(string(s.gameId))
		if err != nil || len(gameIdBytes) != 32 {
			return types.NewProtocolError(types.ErrSerialisation, "game_id is not 32-byte hex")
		}
		ok, verr := cryptocards.VerifyEntropyReveal(commitmentBytes, entropyBytes, playerIdBytes, gameIdBytes)
		if verr != nil {
			return types.NewProtocolError(types.ErrInvalidRevealProof, verr.Error())
		}
		if !ok {
			return types.NewProtocolError(types.ErrInvalidRevealProof, "entropy does not match prior commitment")
		}

	case types.ActionCardReveal:
		if s.state.CombinedEntropy == "" {
			return types.NewProtocolError(types.ErrInvalidStateTransition, "no combined entropy yet")
		}
		combined, err := hex.DecodeString(string(s.state.CombinedEntropy))
		if err != nil || len(combined) != 32 {
			return types.NewProtocolError(types.ErrSerialisation, "combined_entropy not 32-byte hex")
		}
		dc, err := cryptocards.BuildDeckCommitment(combined, s.ruleSet.DeckFormat, s.ruleSet.ShuffleAlgorithmVersion)
		if err != nil {
			return types.NewProtocolError(types.ErrInvalidStateTransition, err.Error())
		}
		pos := a.Reveal.Position
		if pos < 0 || pos >= len(dc.PerPosition) {
			return types.NewProtocolError(types.ErrInvalidRevealProof, fmt.Sprintf("position %d out of range", pos))
		}
		cardNonce, err := hex.DecodeString(string(a.Reveal.CardNonce))
		if err != nil || len(cardNonce) != 32 {
			return types.NewProtocolError(types.ErrSerialisation, "card_nonce not 32-byte hex")
		}
		deckNonce, err := hex.DecodeString(string(a.Reveal.DeckNonce))
		if err != nil || len(deckNonce) != 32 {
			return types.NewProtocolError(types.ErrSerialisation, "deck_nonce not 32-byte hex")
		}
		ok, verr := cryptocards.VerifyRevealProof(dc.PerPosition[pos].Commitment, cryptocards.RevealProof{
			Position:  a.Reveal.Position,
			Ordinal:   a.Reveal.RevealedCard.Ordinal,
			CardNonce: cardNonce,
			DeckNonce: deckNonce,
		})
		if verr != nil {
			return types.NewProtocolError(types.ErrInvalidRevealProof, verr.Error())
		}
		if !ok {
			return types.NewProtocolError(types.ErrInvalidRevealProof, "card reveal does not match deck commitment")
		}
	}
	return nil
}

// Transcript returns a copy of the ordered list of accepted actions.
func (s *Session) Transcript() []types.SignedAction {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]types.SignedAction, len(s.transcript))
	copy(out, s.transcript)
	return out
}

// Replay re-applies the recorded transcript against a fresh initial
// state and checks that it produces the same final state. Used to
// verify deterministic replay.
func (s *Session) Replay(ruleSetHash types.RuleSetHash, recoveryDeadline types.BlockHeight) (types.RoundState, *types.ProtocolError) {
	s.mu.Lock()
	transcript := make([]types.SignedAction, len(s.transcript))
	heights := make([]types.BlockHeight, len(s.heights))
	copy(transcript, s.transcript)
	copy(heights, s.heights)
	initial := engine.InitialState(s.gameId, ruleSetHash, recoveryDeadline)
	ruleSet := s.ruleSet
	s.mu.Unlock()

	state, _, perr := engine.Replay(initial, ruleSet, transcript, heights)
	return state, perr
}
