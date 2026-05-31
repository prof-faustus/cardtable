// Command indexer is the stand-alone audit harness: it ingests a
// transcript file (one JSON-encoded SignedAction per line, optional
// trailing block_heights line) and replays it through the engine,
// printing the final state hash and any rejection.
//
// Use as a smoke test ("did this session run honestly?") or as the
// kernel of a future indexer service that persists per-round state.
//
// Architectural note: PROJECT_SPEC.md places the indexer at
// apps/indexer-go as a separate Go module. For now we colocate it
// with the relay so both share the engine + cryptocards packages
// without a replace directive — a forthcoming ADR-002 will record
// the deviation and the migration path.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/prof-faustus/cardtable/relay-go/pkg/engine"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

func main() {
	transcriptPath := flag.String("transcript", "", "path to a transcript file (one JSON SignedAction per line); '-' reads stdin")
	gameId := flag.String("game-id", "", "game_id this transcript belongs to (used for engine seeding)")
	ruleSetHash := flag.String("rule-set-hash", "0000000000000000000000000000000000000000000000000000000000000000", "agreed rule_set_hash")
	recoveryHeight := flag.Uint("recovery-height", 244, "absolute block height for the global recovery branch")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *transcriptPath == "" {
		logger.Error("must supply --transcript")
		os.Exit(2)
	}
	if *gameId == "" {
		logger.Error("must supply --game-id")
		os.Exit(2)
	}

	actions, err := loadTranscript(*transcriptPath)
	if err != nil {
		logger.Error("load transcript", "err", err)
		os.Exit(1)
	}
	logger.Info("loaded transcript", "actions", len(actions))

	rs := types.RuleSet{
		GameType:                types.GameInBetween,
		PlayerCountMin:          2,
		PlayerCountMax:          4,
		StakeAmount:             1000,
		MinBet:                  1,
		MaxBet:                  100,
		DecisionTimeoutBlocks:   6,
		RecoveryTimeoutBlocks:   144,
		InvitationWindowBlocks:  18,
		DeckFormat:              52,
		ShuffleAlgorithmVersion: 1,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
			ConsecutiveCardsPenalty: 50,
			EqualCardsPenalty:       100,
		},
	}
	state := engine.InitialState(types.GameId(*gameId), types.RuleSetHash(*ruleSetHash), types.BlockHeight(*recoveryHeight))

	for i, a := range actions {
		next, perr := engine.ApplyAction(state, a, rs, 100)
		if perr != nil {
			logger.Error("rejected", "index", i, "action_type", a.ActionType, "code", perr.Code, "context", perr.Context)
			os.Exit(1)
		}
		state = next
	}

	out, err := json.MarshalIndent(map[string]any{
		"final_state_class":         state.StateClass,
		"final_pot_value":           state.PotValue,
		"final_round_number":        state.RoundNumber,
		"final_player_count":        len(state.Players),
		"final_combined_entropy":    state.CombinedEntropy,
		"final_deck_commitment":     state.DeckCommitmentHash,
		"transcript_actions_count":  len(actions),
	}, "", "  ")
	if err != nil {
		logger.Error("marshal summary", "err", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(append(out, '\n')); err != nil {
		logger.Error("write summary", "err", err)
		os.Exit(1)
	}
}

func loadTranscript(path string) ([]types.SignedAction, error) {
	var r io.Reader
	switch path {
	case "-":
		r = os.Stdin
	default:
		f, err := os.Open(path)
		if err != nil {
			return nil, fmt.Errorf("open: %w", err)
		}
		defer f.Close()
		r = f
	}
	var actions []types.SignedAction
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var a types.SignedAction
		if err := json.Unmarshal(line, &a); err != nil {
			return nil, fmt.Errorf("parse action %d: %w", len(actions), err)
		}
		actions = append(actions, a)
	}
	if err := sc.Err(); err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return actions, nil
}
