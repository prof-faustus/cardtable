// Command spv is the stand-alone SPV header + merkle-proof service.
//
// Wires together internal/spv.RPCClient (production) or FakeRPC
// (dev/test), an in-memory header cache, and an HTTP server. The
// relay can consult /headers/latest for its CurrentHeight callback;
// downstream auditors hit /merkle-proof?txid=... to verify
// on-chain inclusion.
//
// Architectural note: per PROJECT_SPEC.md the SPV service lives at
// apps/spv-service-go/. For now it's colocated with the relay's Go
// module to share pkg/types and friends — same pattern ADR-002
// records for the indexer.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prof-faustus/cardtable/relay-go/internal/spv"
)

func main() {
	addr := flag.String("addr", ":8082", "HTTP listen address")
	rpcURL := flag.String("rpc-url", "", "BSV node JSON-RPC URL (empty = use fake stub for dev)")
	rpcUser := flag.String("rpc-user", "", "BSV node RPC username")
	rpcPass := flag.String("rpc-pass", "", "BSV node RPC password")
	pollInterval := flag.Duration("poll-interval", 5*time.Second, "tip refresh interval")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	var rpc spv.BsvRPC
	if *rpcURL == "" {
		logger.Info("no --rpc-url; serving from a fake RPC stub (dev only)")
		rpc = &spv.FakeRPC{
			BestHeight: 100,
			Headers:    map[uint32]spv.BlockHeader{},
			Proofs:     map[string]spv.MerkleProof{},
		}
	} else {
		rpc = spv.NewRPCClient(*rpcURL, *rpcUser, *rpcPass)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	cache := spv.NewHeaderCache(rpc, *pollInterval)
	cache.Start(ctx)
	defer cache.Stop()

	srv := spv.NewServer(spv.ServerConfig{Addr: *addr, Logger: logger}, cache, rpc)
	logger.Info("starting spv service", "addr", *addr, "rpc_url", *rpcURL)
	if err := srv.ListenAndServe(ctx); err != nil {
		logger.Error("spv terminated", "err", err)
		os.Exit(1)
	}
	logger.Info("spv shut down cleanly")
}
