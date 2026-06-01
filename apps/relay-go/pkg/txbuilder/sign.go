package txbuilder

import (
	"fmt"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	secpecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// SignSighash ECDSA-signs a 32-byte sighash digest with a 32-byte
// secp256k1 private key and returns the DER-encoded signature.
//
// Low-S enforcement is the decred library's default for Sign().
// The returned bytes are the wire form BSV CHECKSIG verifies;
// callers append the 1-byte hashType to assemble the unlocking
// script's signature push.
func SignSighash(sighash, privKey []byte) ([]byte, error) {
	if len(sighash) != 32 {
		return nil, fmt.Errorf("SignSighash: sighash must be 32 bytes, got %d", len(sighash))
	}
	if len(privKey) != 32 {
		return nil, fmt.Errorf("SignSighash: privKey must be 32 bytes, got %d", len(privKey))
	}
	priv := secp256k1.PrivKeyFromBytes(privKey)
	sig := secpecdsa.Sign(priv, sighash)
	return sig.Serialize(), nil
}

// VerifySighashSignature returns true iff `derSig` is a valid
// ECDSA-on-secp256k1 signature of `sighash` under `pubKey` (33-byte
// compressed). Used by tests; on-chain CHECKSIG performs the same
// verification.
func VerifySighashSignature(derSig, sighash, pubKey []byte) (bool, error) {
	if len(sighash) != 32 {
		return false, fmt.Errorf("VerifySighashSignature: sighash must be 32 bytes")
	}
	if len(pubKey) != 33 {
		return false, fmt.Errorf("VerifySighashSignature: pubKey must be 33-byte compressed")
	}
	pub, err := secp256k1.ParsePubKey(pubKey)
	if err != nil {
		return false, fmt.Errorf("ParsePubKey: %w", err)
	}
	sig, err := secpecdsa.ParseDERSignature(derSig)
	if err != nil {
		return false, nil // malformed DER → just "not valid"
	}
	return sig.Verify(sighash, pub), nil
}

// PubKeyFromPriv returns the 33-byte compressed pubkey for the
// supplied 32-byte private key.
func PubKeyFromPriv(privKey []byte) ([]byte, error) {
	if len(privKey) != 32 {
		return nil, fmt.Errorf("PubKeyFromPriv: privKey must be 32 bytes")
	}
	priv := secp256k1.PrivKeyFromBytes(privKey)
	return priv.PubKey().SerializeCompressed(), nil
}
