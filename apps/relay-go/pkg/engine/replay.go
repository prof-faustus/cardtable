package engine

import "github.com/prof-faustus/cardtable/relay-go/pkg/types"

// Replay applies a sequence of signed actions to an initial state and
// returns either the final state or the first error encountered, with
// the index of the offending action. `heights` must be the same length
// as `actions` and supply the block height to use for each action's
// transition (timeouts and recovery use this).
func Replay(initial types.RoundState, ruleSet types.RuleSet, actions []types.SignedAction, heights []types.BlockHeight) (types.RoundState, int, *types.ProtocolError) {
	if len(actions) != len(heights) {
		return initial, -1, types.NewProtocolError(types.ErrInvalidStateTransition, "Replay: actions/heights length mismatch")
	}
	state := initial
	for i, a := range actions {
		next, perr := ApplyAction(state, a, ruleSet, heights[i])
		if perr != nil {
			return state, i, perr
		}
		state = next
	}
	return state, len(actions), nil
}
