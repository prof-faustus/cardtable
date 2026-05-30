// Package engine is the pure deterministic In-Between state machine.
// Every exported function is total over (state, action, ruleSet, height)
// and returns either the successor state or a typed ProtocolError.
// There is no clock, no I/O, no shared state.
package engine

import (
	"fmt"
	"math"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// AddToPot adds delta satoshis to the pot. Overflow into the unsafe
// integer range raises an error.
func AddToPot(pot, delta types.Satoshis) (types.Satoshis, error) {
	next := uint64(pot) + uint64(delta)
	if next > math.MaxInt64 {
		return 0, fmt.Errorf("AddToPot: pot overflow (%d + %d)", pot, delta)
	}
	return types.Satoshis(next), nil
}

// SubtractFromPot subtracts delta from the pot. Underflow raises.
func SubtractFromPot(pot, delta types.Satoshis) (types.Satoshis, error) {
	if delta > pot {
		return 0, fmt.Errorf("SubtractFromPot: underflow (%d - %d)", pot, delta)
	}
	return pot - delta, nil
}
