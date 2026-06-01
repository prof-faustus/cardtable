// Package txbuilder is the Go peer of @cardtable/tx-builder.
//
// Every function here produces or consumes the exact bytes BSV
// consensus accepts. Two implementations (TS + Go) must agree
// byte-for-byte on the same logical inputs; the cross-language
// test vector at spec/test-vectors/tx-builder.json is the binding
// surface.
package txbuilder

// TxInput is one prevout reference + unlocking script + sequence.
type TxInput struct {
	PrevTxid        []byte // 32 bytes, internal byte order
	PrevVout        uint32
	UnlockingScript []byte
	Sequence        uint32
}

// TxOutput is one (value, lockingScript) pair.
type TxOutput struct {
	Value         uint64
	LockingScript []byte
}

// BsvTransaction is the canonical BSV wire-format transaction.
type BsvTransaction struct {
	Version  int32
	Inputs   []TxInput
	Outputs  []TxOutput
	LockTime uint32
}

// SIGHASH flags. BSV post-Genesis mandates SIGHASH_FORKID.
const (
	SighashAll          uint32 = 0x01
	SighashNone         uint32 = 0x02
	SighashSingle       uint32 = 0x03
	SighashForkID       uint32 = 0x40
	SighashAnyoneCanPay uint32 = 0x80

	// SighashAllForkID is the canonical "sign all outputs" form
	// for BSV transactions.
	SighashAllForkID uint32 = SighashAll | SighashForkID
)
