package txbuilder

import (
	"fmt"
)

var zero32Sig = make([]byte, 32)

// SighashInputs carries the per-input data needed to compute the
// BIP-143 sighash that BSV consensus verifies.
type SighashInputs struct {
	Tx         BsvTransaction
	InputIdx   int
	PrevScript []byte
	PrevValue  uint64
	HashType   uint32
}

func isBaseSighash(t uint32, base uint32) bool { return (t & 0x1f) == base }

func hashPrevouts(tx BsvTransaction, hashType uint32) []byte {
	if hashType&SighashAnyoneCanPay != 0 {
		return zero32Sig
	}
	parts := [][]byte{}
	for _, in := range tx.Inputs {
		parts = append(parts, in.PrevTxid, EncU32LE(in.PrevVout))
	}
	return sha256d(concat(parts...))
}

func hashSequence(tx BsvTransaction, hashType uint32) []byte {
	if hashType&SighashAnyoneCanPay != 0 {
		return zero32Sig
	}
	if isBaseSighash(hashType, SighashNone) || isBaseSighash(hashType, SighashSingle) {
		return zero32Sig
	}
	parts := [][]byte{}
	for _, in := range tx.Inputs {
		parts = append(parts, EncU32LE(in.Sequence))
	}
	return sha256d(concat(parts...))
}

func hashOutputs(tx BsvTransaction, inputIdx int, hashType uint32) []byte {
	if isBaseSighash(hashType, SighashAll) {
		parts := [][]byte{}
		for _, o := range tx.Outputs {
			parts = append(parts,
				EncU64LE(o.Value),
				EncVarint(uint64(len(o.LockingScript))),
				o.LockingScript,
			)
		}
		return sha256d(concat(parts...))
	}
	if isBaseSighash(hashType, SighashSingle) && inputIdx < len(tx.Outputs) {
		o := tx.Outputs[inputIdx]
		return sha256d(concat(
			EncU64LE(o.Value),
			EncVarint(uint64(len(o.LockingScript))),
			o.LockingScript,
		))
	}
	return zero32Sig
}

// ComputeSighash returns the BIP-143 sighash for the named input.
// SIGHASH_FORKID is mandatory on BSV; the function rejects any
// hashType missing it.
func ComputeSighash(in SighashInputs) ([]byte, error) {
	if in.HashType&SighashForkID == 0 {
		return nil, fmt.Errorf("ComputeSighash: BSV requires SIGHASH_FORKID")
	}
	if in.InputIdx < 0 || in.InputIdx >= len(in.Tx.Inputs) {
		return nil, fmt.Errorf("ComputeSighash: input index %d out of range", in.InputIdx)
	}
	i := in.Tx.Inputs[in.InputIdx]
	preimage := concat(
		EncI32LE(in.Tx.Version),
		hashPrevouts(in.Tx, in.HashType),
		hashSequence(in.Tx, in.HashType),
		i.PrevTxid,
		EncU32LE(i.PrevVout),
		EncVarint(uint64(len(in.PrevScript))),
		in.PrevScript,
		EncU64LE(in.PrevValue),
		EncU32LE(i.Sequence),
		hashOutputs(in.Tx, in.InputIdx, in.HashType),
		EncU32LE(in.Tx.LockTime),
		EncU32LE(in.HashType),
	)
	return sha256d(preimage), nil
}
