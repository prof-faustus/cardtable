# syntax=docker/dockerfile:1.7

# ---- builder stage ---------------------------------------------------------
FROM golang:1.23-alpine AS builder

WORKDIR /src

# Cache module downloads on the relay's go.mod. There are no external
# dependencies yet, so this is a stable layer.
COPY apps/relay-go/go.mod ./apps/relay-go/

WORKDIR /src/apps/relay-go
RUN go mod download

# Copy the full Go source tree.
COPY apps/relay-go/ ./

# Build static binaries for the relay and the indexer. The reproducible
# build flags (-trimpath, -buildvcs=false, -ldflags="-s -w") cut size
# without sacrificing semantics.
ENV CGO_ENABLED=0
RUN go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/relay ./cmd/relay
RUN go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/indexer ./cmd/indexer
RUN go build -trimpath -buildvcs=false -ldflags="-s -w" -o /out/spv ./cmd/spv

# ---- runtime stage ---------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot

LABEL org.opencontainers.image.title="cardtable-relay"
LABEL org.opencontainers.image.description="Cardtable BSV relay: binary wire-protocol over TCP and WebSocket; mental-poker verification gate."
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/prof-faustus/cardtable"

# Non-root by default (distroless:nonroot uses uid 65532).
USER nonroot

COPY --from=builder /out/relay   /usr/local/bin/relay
COPY --from=builder /out/indexer /usr/local/bin/indexer
COPY --from=builder /out/spv     /usr/local/bin/spv

EXPOSE 8080 8081

ENTRYPOINT ["/usr/local/bin/relay"]
CMD ["--addr", ":8080", "--ws-addr", ":8081", "--game", "00000000000000000000000000000000000000000000000000000000000000aa", "--start-height", "100"]
