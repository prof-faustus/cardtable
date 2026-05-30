// Package session holds the per-game runtime state. A Session wraps
// the pure engine state with the bits a relay needs that the engine
// deliberately omits: action nonce dedup, the audit transcript, and
// the latest accepted state hash.
package session

import (
	"sync"

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

// Submit applies a signed action with replay protection. If the
// action nonce has been seen before, the call is rejected with
// STALE_STATE. Otherwise the engine is consulted and, on success,
// the action is appended to the transcript.
func (s *Session) Submit(action types.SignedAction, height types.BlockHeight) (types.RoundState, *types.ProtocolError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.seenNonces[action.ActionNonce]; ok {
		return s.state, types.NewProtocolError(types.ErrStaleState, "action nonce already accepted")
	}
	next, err := engine.ApplyAction(s.state, action, s.ruleSet, height)
	if err != nil {
		return s.state, err
	}
	s.seenNonces[action.ActionNonce] = struct{}{}
	s.transcript = append(s.transcript, action)
	s.heights = append(s.heights, height)
	s.state = next
	return next, nil
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
