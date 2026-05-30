// Command relay is the cardtable WebSocket-bound relay server.
// Phase 3b serves the binary frame protocol over plain TCP; a
// WebSocket adapter will be bolted on when apps/client-web lands.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/prof-faustus/cardtable/relay-go/internal/broadcast"
	"github.com/prof-faustus/cardtable/relay-go/internal/relay"
	"github.com/prof-faustus/cardtable/relay-go/internal/session"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address (host:port)")
	gameId := flag.String("game", "demo-game", "game_id for the single hosted session")
	stake := flag.Uint64("stake", 1000, "session stake amount in sats")
	minBet := flag.Uint64("min-bet", 1, "minimum bet in sats")
	maxBet := flag.Uint64("max-bet", 100, "maximum bet in sats")
	startHeight := flag.Uint("start-height", 100, "initial block height the relay reports to the engine")
	readTimeout := flag.Duration("read-timeout", 30*time.Second, "per-frame read deadline")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ruleSet := types.RuleSet{
		GameType:              types.GameInBetween,
		PlayerCountMin:        2,
		PlayerCountMax:        4,
		StakeAmount:           types.Satoshis(*stake),
		MinBet:                types.Satoshis(*minBet),
		MaxBet:                types.Satoshis(*maxBet),
		DecisionTimeoutBlocks: 6,
		RecoveryTimeoutBlocks: 144,
		SettlementRules: types.SettlementRules{
			InBetweenWinMultiplier:  1,
			InBetweenLossMultiplier: 1,
			ConsecutiveCardsPenalty: 50,
			EqualCardsPenalty:       100,
		},
	}
	sess := session.New(types.GameId(*gameId), ruleSet, "0000000000000000000000000000000000000000000000000000000000000099", 144)
	hub := broadcast.New(64)

	// In the reference binary the chain height is a monotonic counter
	// the operator advances manually (e.g. for timeout testing). A
	// future SPV-service integration will replace this.
	var height atomic.Uint32
	height.Store(uint32(*startHeight))

	srv := relay.NewServer(relay.Config{
		Addr:        *addr,
		ReadTimeout: *readTimeout,
		CurrentHeight: func() types.BlockHeight {
			return types.BlockHeight(height.Load())
		},
		Logger: logger,
	}, sess, hub)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	logger.Info("starting cardtable relay",
		"addr", *addr,
		"game_id", *gameId,
		"stake", *stake,
		"start_height", *startHeight,
	)
	if err := srv.ListenAndServe(ctx); err != nil {
		logger.Error("relay terminated with error", "err", err)
		os.Exit(1)
	}
	logger.Info("relay shut down cleanly")
}
