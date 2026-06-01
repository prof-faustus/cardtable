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
	"github.com/prof-faustus/cardtable/relay-go/internal/spv"
	"github.com/prof-faustus/cardtable/relay-go/internal/wsadapter"
	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

func main() {
	addr := flag.String("addr", ":8080", "TCP listen address (host:port)")
	wsAddr := flag.String("ws-addr", ":8081", "WebSocket HTTP listen address (host:port)")
	// game_id MUST be 64 lowercase hex chars: the mental-poker
	// verification gate at session.verifyCrypto.entropy passes the
	// game_id through hex.DecodeString to feed into the 32-byte
	// commitment input. A non-hex value would make every
	// EntropyReveal fail with SERIALISATION_ERROR. The default below
	// is a 32-byte zero hash for development.
	gameId := flag.String("game", "00000000000000000000000000000000000000000000000000000000000000aa", "game_id (64-char lowercase hex)")
	stake := flag.Uint64("stake", 1000, "session stake amount in sats")
	minBet := flag.Uint64("min-bet", 1, "minimum bet in sats")
	maxBet := flag.Uint64("max-bet", 100, "maximum bet in sats")
	startHeight := flag.Uint("start-height", 100, "initial block height the relay reports to the engine (also used as fallback when --spv-url is unset)")
	spvURL := flag.String("spv-url", "", "if set, poll this SPV-service base URL for the chain tip (e.g. http://localhost:8082)")
	spvPollInterval := flag.Duration("spv-poll-interval", 5*time.Second, "SPV /headers/latest poll cadence when --spv-url is set")
	readTimeout := flag.Duration("read-timeout", 30*time.Second, "per-frame read deadline")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ruleSet := types.RuleSet{
		GameType:                types.GameInBetween,
		PlayerCountMin:          2,
		PlayerCountMax:          4,
		StakeAmount:             types.Satoshis(*stake),
		MinBet:                  types.Satoshis(*minBet),
		MaxBet:                  types.Satoshis(*maxBet),
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
		SerialisationVersion: 1,
	}
	sess := session.New(types.GameId(*gameId), ruleSet, "0000000000000000000000000000000000000000000000000000000000000099", 144)
	hub := broadcast.New(64)

	// Chain-height source:
	//   - With --spv-url set, poll the SPV service's /headers/latest.
	//   - Otherwise, fall back to the static --start-height (useful
	//     for offline development and the existing CI tests that
	//     don't run a BSV node).
	var height atomic.Uint32
	height.Store(uint32(*startHeight))
	currentHeight := func() types.BlockHeight {
		return types.BlockHeight(height.Load())
	}
	var spvSource *spv.HTTPHeightSource
	if *spvURL != "" {
		spvSource = spv.NewHTTPHeightSource(*spvURL, *spvPollInterval)
		spvSource.SetInitial(uint32(*startHeight))
		currentHeight = func() types.BlockHeight { return spvSource.Current() }
		logger.Info("spv height source configured", "url", *spvURL, "poll_interval", *spvPollInterval)
	}

	srv := relay.NewServer(relay.Config{
		Addr:          *addr,
		ReadTimeout:   *readTimeout,
		CurrentHeight: currentHeight,
		Logger:        logger,
	}, sess, hub)

	wsSrv := wsadapter.NewServer(wsadapter.Config{
		Addr:          *wsAddr,
		CurrentHeight: currentHeight,
		Logger:        logger,
	}, sess, hub)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if spvSource != nil {
		spvSource.Start(ctx)
	}

	logger.Info("starting cardtable relay",
		"tcp_addr", *addr,
		"ws_addr", *wsAddr,
		"game_id", *gameId,
		"stake", *stake,
		"start_height", *startHeight,
		"spv_url", *spvURL,
	)

	errs := make(chan error, 2)
	go func() { errs <- srv.ListenAndServe(ctx) }()
	go func() { errs <- wsSrv.ListenAndServe(ctx) }()

	if err := <-errs; err != nil {
		logger.Error("relay terminated with error", "err", err)
		os.Exit(1)
	}
	cancel()
	<-errs
	logger.Info("relay shut down cleanly")
}
