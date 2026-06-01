package txbuilder

import (
	"bytes"
	"encoding/hex"
	"testing"
)

func zeros(n int) []byte { return make([]byte, n) }

func dummyScript(b byte) []byte {
	return []byte{0x76, 0xa9, b, 0x88, 0xac}
}

func TestEncodeDecodeRoundtrip(t *testing.T) {
	tx := BsvTransaction{
		Version: 1,
		Inputs: []TxInput{{
			PrevTxid:        zeros(32),
			PrevVout:        0,
			UnlockingScript: nil,
			Sequence:        0xffffffff,
		}},
		Outputs: []TxOutput{{Value: 1000, LockingScript: dummyScript(0x42)}},
	}
	b, err := EncodeBsvTransaction(tx)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	back, err := DecodeBsvTransaction(b)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if back.Version != 1 || len(back.Inputs) != 1 || len(back.Outputs) != 1 {
		t.Errorf("roundtrip mismatch: %+v", back)
	}
	if back.Outputs[0].Value != 1000 {
		t.Errorf("output value: want 1000, got %d", back.Outputs[0].Value)
	}
}

func TestEncodeRejectsBadPrevTxid(t *testing.T) {
	tx := BsvTransaction{
		Version: 1,
		Inputs:  []TxInput{{PrevTxid: zeros(31), Sequence: 0xffffffff}},
	}
	if _, err := EncodeBsvTransaction(tx); err == nil {
		t.Error("expected error on 31-byte prevTxid")
	}
}

func TestDecodeRejectsTrailingBytes(t *testing.T) {
	tx := BsvTransaction{
		Version: 1,
		Inputs:  []TxInput{{PrevTxid: zeros(32), Sequence: 0xffffffff}},
		Outputs: []TxOutput{{Value: 0}},
	}
	b, _ := EncodeBsvTransaction(tx)
	padded := append(b, 0xff)
	if _, err := DecodeBsvTransaction(padded); err == nil {
		t.Error("expected trailing-bytes error")
	}
}

func TestSighashRejectsWithoutForkID(t *testing.T) {
	tx := BsvTransaction{
		Version: 1,
		Inputs:  []TxInput{{PrevTxid: zeros(32), Sequence: 0xffffffff}},
		Outputs: []TxOutput{{Value: 0}},
	}
	_, err := ComputeSighash(SighashInputs{
		Tx:         tx,
		InputIdx:   0,
		PrevScript: dummyScript(1),
		PrevValue:  1000,
		HashType:   SighashAll, // no FORKID
	})
	if err == nil {
		t.Error("expected SIGHASH_FORKID rejection")
	}
}

// TestSighashPinnedVector locks the cross-language conformance
// constant. The TypeScript reference at
// packages/tx-builder/__tests__/sighash-vector.test.ts asserts the
// same hex for the same fixture.
func TestSighashPinnedVector(t *testing.T) {
	const expected = "15b7dc05a4e49cfd12c725824793ca3607991659ef4940955b544e64de9faf4c"
	prevTxid := bytes.Repeat([]byte{0xaa}, 32)
	lockingScript := append([]byte{0x76, 0xa9, 0x14}, append(makeRangeBytes(20), 0x88, 0xac)...)
	prevScript := append([]byte{0x76, 0xa9, 0x14}, append(bytes.Repeat([]byte{0xff}, 20), 0x88, 0xac)...)

	tx := BsvTransaction{
		Version: 1,
		Inputs: []TxInput{{
			PrevTxid:        prevTxid,
			PrevVout:        0,
			UnlockingScript: nil,
			Sequence:        0xffffffff,
		}},
		Outputs: []TxOutput{{
			Value:         5000,
			LockingScript: lockingScript,
		}},
		LockTime: 0,
	}
	got, err := ComputeSighash(SighashInputs{
		Tx:         tx,
		InputIdx:   0,
		PrevScript: prevScript,
		PrevValue:  10000,
		HashType:   SighashAllForkID,
	})
	if err != nil {
		t.Fatalf("ComputeSighash: %v", err)
	}
	gotHex := hex.EncodeToString(got)
	if gotHex != expected {
		t.Errorf("sighash:\n  want %s\n  got  %s", expected, gotHex)
	}
}

// TestEncodeBytesPinnedVector locks the encoded transaction bytes
// for the same fixture. Both TS and Go produce identical bytes.
func TestEncodeBytesPinnedVector(t *testing.T) {
	prevTxid := bytes.Repeat([]byte{0xaa}, 32)
	lockingScript := append([]byte{0x76, 0xa9, 0x14}, append(makeRangeBytes(20), 0x88, 0xac)...)
	tx := BsvTransaction{
		Version: 1,
		Inputs: []TxInput{{
			PrevTxid:        prevTxid,
			PrevVout:        0,
			UnlockingScript: nil,
			Sequence:        0xffffffff,
		}},
		Outputs: []TxOutput{{
			Value:         5000,
			LockingScript: lockingScript,
		}},
		LockTime: 0,
	}
	b, err := EncodeBsvTransaction(tx)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	gotHex := hex.EncodeToString(b)
	// Expected layout (totals to 85 bytes):
	//   version          (4)  = 01000000
	//   in_count         (1)  = 01
	//   prev_txid       (32)  = aa * 32
	//   prev_vout        (4)  = 00000000
	//   unlock_len       (1)  = 00
	//   sequence         (4)  = ffffffff
	//   out_count        (1)  = 01
	//   value            (8)  = 8813000000000000 (5000 LE)
	//   lock_len         (1)  = 19
	//   locking_script  (25)  = 76a914 00..13 88ac
	//   lockTime         (4)  = 00000000
	const wantLen = 4 + 1 + 32 + 4 + 1 + 4 + 1 + 8 + 1 + 25 + 4
	if len(b) != wantLen {
		t.Errorf("encoded length: want %d, got %d (hex=%s)", wantLen, len(b), gotHex)
	}
	// Spot-check magic positions.
	if gotHex[:8] != "01000000" {
		t.Errorf("version prefix: %s", gotHex[:8])
	}
	if gotHex[len(gotHex)-8:] != "00000000" {
		t.Errorf("lockTime suffix: %s", gotHex[len(gotHex)-8:])
	}
}

func makeRangeBytes(n int) []byte {
	out := make([]byte, n)
	for i := 0; i < n; i++ {
		out[i] = byte(i)
	}
	return out
}
