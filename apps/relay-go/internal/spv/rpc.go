// Package spv is the SPV header + merkle-proof service that backs
// the relay's chain-height callback and on-chain confirmation checks.
//
// The package is decoupled from any specific BSV node implementation
// via the BsvRPC interface — production wires it to a real
// JSON-RPC client (see Dialer in rpc.go); tests substitute a
// FakeRPC that returns canned responses.
package spv

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

// BlockHeader is the minimal subset of a BSV block header the SPV
// service exposes.
type BlockHeader struct {
	Height        uint32 `json:"height"`
	Hash          string `json:"hash"`            // 64-char hex
	PreviousHash  string `json:"previous_hash"`   // 64-char hex
	MerkleRoot    string `json:"merkle_root"`     // 64-char hex
	Time          uint32 `json:"time"`            // unix seconds
	Bits          uint32 `json:"bits"`            // compact target
	Nonce         uint32 `json:"nonce"`
	Version       int32  `json:"version"`
}

// MerkleProof is one transaction's inclusion proof in a block.
type MerkleProof struct {
	TxId        string   `json:"txid"`         // 64-char hex (reversed display form)
	BlockHash   string   `json:"block_hash"`   // 64-char hex
	BlockHeight uint32   `json:"block_height"`
	Index       int      `json:"index"`        // tx position in block
	Siblings    []string `json:"siblings"`     // ordered sibling hashes
}

// BsvRPC abstracts whatever talks to the BSV node. Real production
// uses RPCClient; tests use FakeRPC.
type BsvRPC interface {
	GetBestBlockHeight(ctx context.Context) (uint32, error)
	GetBlockHeaderByHeight(ctx context.Context, height uint32) (BlockHeader, error)
	GetMerkleProof(ctx context.Context, txid string) (MerkleProof, error)
}

// ---------------------------------------------------------------------------
// Production JSON-RPC client
// ---------------------------------------------------------------------------

// RPCClient speaks Bitcoin Core / BSV-node JSON-RPC over HTTP basic auth.
type RPCClient struct {
	endpoint string
	user     string
	pass     string
	httpc    *http.Client
	id       atomic.Uint64
}

// NewRPCClient configures a BSV node RPC client. `endpoint` is the
// http://host:port/ URL; `user`/`pass` are the rpcuser/rpcpassword
// from the node's bitcoin.conf.
func NewRPCClient(endpoint, user, pass string) *RPCClient {
	return &RPCClient{
		endpoint: endpoint,
		user:     user,
		pass:     pass,
		httpc:    &http.Client{Timeout: 10 * time.Second},
	}
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      uint64 `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params"`
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *rpcError       `json:"error"`
	ID     uint64          `json:"id"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (r *rpcError) Error() string {
	if r == nil {
		return ""
	}
	return fmt.Sprintf("rpc error %d: %s", r.Code, r.Message)
}

func (c *RPCClient) call(ctx context.Context, method string, params []any, out any) error {
	body, err := json.Marshal(rpcRequest{JSONRPC: "1.0", ID: c.id.Add(1), Method: method, Params: params})
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth(c.user, c.pass)
	resp, err := c.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("rpc do: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("rpc status %d: %s", resp.StatusCode, string(raw))
	}
	var r rpcResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return fmt.Errorf("unmarshal: %w (body=%q)", err, string(raw))
	}
	if r.Error != nil {
		return r.Error
	}
	if out != nil {
		return json.Unmarshal(r.Result, out)
	}
	return nil
}

// GetBestBlockHeight returns the chain tip height.
func (c *RPCClient) GetBestBlockHeight(ctx context.Context) (uint32, error) {
	var n uint32
	if err := c.call(ctx, "getblockcount", nil, &n); err != nil {
		return 0, err
	}
	return n, nil
}

// GetBlockHeaderByHeight returns the block header at the given height.
// Uses two RPC calls (getblockhash + getblockheader).
func (c *RPCClient) GetBlockHeaderByHeight(ctx context.Context, height uint32) (BlockHeader, error) {
	var hashHex string
	if err := c.call(ctx, "getblockhash", []any{height}, &hashHex); err != nil {
		return BlockHeader{}, fmt.Errorf("getblockhash %d: %w", height, err)
	}
	var raw struct {
		Hash          string `json:"hash"`
		PreviousBlock string `json:"previousblockhash"`
		MerkleRoot    string `json:"merkleroot"`
		Time          uint32 `json:"time"`
		Bits          string `json:"bits"`
		Nonce         uint32 `json:"nonce"`
		Version       int32  `json:"version"`
		Height        uint32 `json:"height"`
	}
	if err := c.call(ctx, "getblockheader", []any{hashHex, true}, &raw); err != nil {
		return BlockHeader{}, fmt.Errorf("getblockheader: %w", err)
	}
	bitsBytes, err := hex.DecodeString(raw.Bits)
	if err != nil {
		return BlockHeader{}, fmt.Errorf("bits hex: %w", err)
	}
	bitsU32, err := strconv.ParseUint(raw.Bits, 16, 32)
	if err != nil {
		return BlockHeader{}, fmt.Errorf("bits parse: %w", err)
	}
	_ = bitsBytes
	return BlockHeader{
		Height:       raw.Height,
		Hash:         raw.Hash,
		PreviousHash: raw.PreviousBlock,
		MerkleRoot:   raw.MerkleRoot,
		Time:         raw.Time,
		Bits:         uint32(bitsU32),
		Nonce:        raw.Nonce,
		Version:      raw.Version,
	}, nil
}

// GetMerkleProof returns the merkle inclusion proof for `txid`.
// Uses gettxoutproof / decoderawtransaction / getrawtransaction.
//
// Note: the response from getmerkleproof varies across BSV node
// builds; this stub parses the common `{"target": "...", "nodes":
// ["...", ...], "index": N}` form. Production deployments should
// pin a specific node version + format.
func (c *RPCClient) GetMerkleProof(ctx context.Context, txid string) (MerkleProof, error) {
	var raw struct {
		Target      string   `json:"target"`
		Nodes       []string `json:"nodes"`
		Index       int      `json:"index"`
		BlockHash   string   `json:"blockhash"`
		BlockHeight uint32   `json:"blockheight"`
	}
	if err := c.call(ctx, "getmerkleproof", []any{txid}, &raw); err != nil {
		return MerkleProof{}, err
	}
	return MerkleProof{
		TxId:        txid,
		BlockHash:   raw.BlockHash,
		BlockHeight: raw.BlockHeight,
		Index:       raw.Index,
		Siblings:    raw.Nodes,
	}, nil
}

// ---------------------------------------------------------------------------
// Test double
// ---------------------------------------------------------------------------

// FakeRPC is a hand-controlled BsvRPC for tests.
type FakeRPC struct {
	BestHeight uint32
	Headers    map[uint32]BlockHeader
	Proofs     map[string]MerkleProof
}

func (f *FakeRPC) GetBestBlockHeight(_ context.Context) (uint32, error) {
	return f.BestHeight, nil
}

func (f *FakeRPC) GetBlockHeaderByHeight(_ context.Context, height uint32) (BlockHeader, error) {
	h, ok := f.Headers[height]
	if !ok {
		return BlockHeader{}, fmt.Errorf("FakeRPC: no header at height %d", height)
	}
	return h, nil
}

func (f *FakeRPC) GetMerkleProof(_ context.Context, txid string) (MerkleProof, error) {
	p, ok := f.Proofs[txid]
	if !ok {
		return MerkleProof{}, fmt.Errorf("FakeRPC: no proof for txid %q", txid)
	}
	return p, nil
}
