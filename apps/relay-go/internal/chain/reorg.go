// Package chain holds the relay/indexer-side on-chain logic that the
// pure state engine deliberately omits: reorg reindexing
// (spec/ordering-rules.md §5) and mempool-eviction rebroadcast policy
// (§4). The engine's contract is "given this transcript, compute this
// state"; this package decides *which* transcript is canonical as the
// BSV chain evolves, then defers to the engine to fold it.
package chain

import (
	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// Block is one block's confirmed contribution to a game's transcript:
// its hash plus the ordered actions that committed in it. The indexer
// builds these from merkle-proven transactions; tests construct them
// directly.
type Block struct {
	Hash    string
	Height  types.BlockHeight
	Actions []types.SignedAction
}

// DeepestCommonAncestor returns the length of the shared prefix of two
// chains presented ancestor-first (genesis at index 0). Blocks are
// compared by hash. The result is spec/ordering-rules.md §5 step 1:
// the point up to which old and new chains agree.
func DeepestCommonAncestor(oldChain, newChain []Block) int {
	n := len(oldChain)
	if len(newChain) < n {
		n = len(newChain)
	}
	i := 0
	for i < n && oldChain[i].Hash == newChain[i].Hash {
		i++
	}
	return i
}

// flatten extracts the actions and their confirmation heights from a
// run of blocks, in block-then-in-block order.
func flatten(blocks []Block) ([]types.SignedAction, []types.BlockHeight) {
	var actions []types.SignedAction
	var heights []types.BlockHeight
	for _, b := range blocks {
		for _, a := range b.Actions {
			actions = append(actions, a)
			heights = append(heights, b.Height)
		}
	}
	return actions, heights
}

// ReindexResult is the outcome of a reorg reindex.
type ReindexResult struct {
	// State is the canonical state after forward-applying newChain.
	State types.RoundState
	// Orphaned lists the actions that were confirmed only in the
	// abandoned chain (oldChain after the common ancestor) and are no
	// longer part of the canonical transcript. The relay should
	// re-evaluate these for rebroadcast.
	Orphaned []types.SignedAction
	// AncestorBlocks is the length of the shared prefix (§5 step 1).
	AncestorBlocks int
}

// Reindex implements spec/ordering-rules.md §5. Given the engine seed
// (`initial`, `rs`), the previously-indexed `oldChain`, and the new
// canonical `newChain`, it:
//
//  1. finds the deepest common ancestor,
//  2. rewinds engine state to that ancestor (replays the shared prefix),
//  3. forward-applies the new chain's suffix from the ancestor state.
//
// The engine is pure, so steps 2-3 are an explicit replay rather than
// an in-place undo. Reindex also reports which actions were orphaned
// by the reorg so the relay can decide whether to rebroadcast them.
func Reindex(initial types.RoundState, rs types.RuleSet, oldChain, newChain []Block) (ReindexResult, *types.ProtocolError) {
	anc := DeepestCommonAncestor(oldChain, newChain)

	// (1) collect the actions orphaned by the reorg.
	var orphaned []types.SignedAction
	for _, b := range oldChain[anc:] {
		orphaned = append(orphaned, b.Actions...)
	}

	// (2) rewind: state at the common ancestor = replay shared prefix.
	prefixActions, prefixHeights := flatten(newChain[:anc])
	ancestorState, _, perr := engine.Replay(initial, rs, prefixActions, prefixHeights)
	if perr != nil {
		return ReindexResult{}, perr
	}

	// (3) forward-apply the new chain's suffix from the ancestor.
	suffixActions, suffixHeights := flatten(newChain[anc:])
	finalState, _, perr := engine.Replay(ancestorState, rs, suffixActions, suffixHeights)
	if perr != nil {
		return ReindexResult{}, perr
	}

	return ReindexResult{
		State:          finalState,
		Orphaned:       orphaned,
		AncestorBlocks: anc,
	}, nil
}
