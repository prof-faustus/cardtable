package txbuilder

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// TestSignVerifyRoundtrip: signing a known sighash with a known
// private key yields a DER signature that verifies under the
// matching pubkey.
func TestSignVerifyRoundtrip(t *testing.T) {
	// 32-byte zero private key would be rejected by libsecp; pick
	// a fixed non-trivial scalar so the test is deterministic.
	priv := bytes.Repeat([]byte{0x01}, 31)
	priv = append(priv, 0x02) // 32 bytes: 0x01..01 02

	pub, err := PubKeyFromPriv(priv)
	if err != nil {
		t.Fatalf("PubKeyFromPriv: %v", err)
	}
	if len(pub) != 33 {
		t.Errorf("pub length: want 33, got %d", len(pub))
	}

	sighash := bytes.Repeat([]byte{0xaa}, 32)
	der, err := SignSighash(sighash, priv)
	if err != nil {
		t.Fatalf("SignSighash: %v", err)
	}
	ok, err := VerifySighashSignature(der, sighash, pub)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !ok {
		t.Error("signature did not verify under its own pubkey")
	}
}

// TestVerifyRejectsWrongKey: a signature under privA must NOT
// verify under pubB.
func TestVerifyRejectsWrongKey(t *testing.T) {
	privA := bytes.Repeat([]byte{0x11}, 32)
	privB := bytes.Repeat([]byte{0x22}, 32)
	pubB, _ := PubKeyFromPriv(privB)
	sighash := bytes.Repeat([]byte{0xbb}, 32)
	der, _ := SignSighash(sighash, privA)
	ok, _ := VerifySighashSignature(der, sighash, pubB)
	if ok {
		t.Error("signature verified under wrong pubkey")
	}
}

// TestVerifyRejectsTamperedSighash: changing the sighash after
// signing breaks the verification.
func TestVerifyRejectsTamperedSighash(t *testing.T) {
	priv := bytes.Repeat([]byte{0x33}, 32)
	pub, _ := PubKeyFromPriv(priv)
	sighash := bytes.Repeat([]byte{0xcc}, 32)
	der, _ := SignSighash(sighash, priv)
	tampered := bytes.Repeat([]byte{0xcc}, 32)
	tampered[0] ^= 0xff
	ok, _ := VerifySighashSignature(der, tampered, pub)
	if ok {
		t.Error("signature verified against tampered sighash")
	}
}

// TestVerifyRejectsMalformedDer: garbage DER bytes return (false, nil).
func TestVerifyRejectsMalformedDer(t *testing.T) {
	priv := bytes.Repeat([]byte{0x44}, 32)
	pub, _ := PubKeyFromPriv(priv)
	sighash := bytes.Repeat([]byte{0xdd}, 32)
	ok, err := VerifySighashSignature([]byte{0xff, 0xff, 0xff}, sighash, pub)
	if err != nil {
		t.Errorf("expected nil error on malformed DER, got %v", err)
	}
	if ok {
		t.Error("malformed DER reported as valid")
	}
}

// TestSighashThenSignVerifies wires the full BIP-143 path against
// the Go signer to prove the sighash + signer agree.
func TestSighashThenSignVerifies(t *testing.T) {
	priv := bytes.Repeat([]byte{0x55}, 32)
	pub, _ := PubKeyFromPriv(priv)
	tx := BsvTransaction{
		Version: 1,
		Inputs: []TxInput{{
			PrevTxid:        bytes.Repeat([]byte{0xee}, 32),
			PrevVout:        0,
			UnlockingScript: nil,
			Sequence:        0xffffffff,
		}},
		Outputs: []TxOutput{{Value: 100, LockingScript: []byte{0x51}}},
	}
	prevScript := []byte{0x76, 0xa9, 0x14, 0x00, 0x88, 0xac}
	sighash, err := ComputeSighash(SighashInputs{
		Tx:         tx,
		InputIdx:   0,
		PrevScript: prevScript,
		PrevValue:  500,
		HashType:   SighashAllForkID,
	})
	if err != nil {
		t.Fatalf("ComputeSighash: %v", err)
	}
	der, err := SignSighash(sighash, priv)
	if err != nil {
		t.Fatalf("SignSighash: %v", err)
	}
	ok, err := VerifySighashSignature(der, sighash, pub)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !ok {
		t.Errorf("full path failed; sighash=%s der=%s", hex.EncodeToString(sighash), hex.EncodeToString(der))
	}
}
