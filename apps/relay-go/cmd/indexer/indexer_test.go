package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/prof-faustus/cardtable/relay-go/pkg/types"
)

// TestLoadTranscriptRoundtrip exercises the JSONL parser against a
// small two-action transcript and verifies the parser preserves the
// action types byte-for-byte.
func TestLoadTranscriptRoundtrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "transcript.jsonl")
	seat0 := types.Seat(0)
	actions := []types.SignedAction{
		{GameId: "a", ActionType: types.ActionJoin, ActionNonce: "01", ActingPlayerSeat: &seat0, PlayerPubkey: "02" + "00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00"+"00", StakeAmount: 1000},
		{GameId: "a", ActionType: types.ActionTableLock, ActionNonce: "02"},
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	for _, a := range actions {
		b, _ := json.Marshal(a)
		f.Write(b)
		f.Write([]byte{'\n'})
	}
	f.Close()

	loaded, err := loadTranscript(path)
	if err != nil {
		t.Fatalf("loadTranscript: %v", err)
	}
	if len(loaded) != len(actions) {
		t.Fatalf("count: want %d, got %d", len(actions), len(loaded))
	}
	for i := range actions {
		if loaded[i].ActionType != actions[i].ActionType {
			t.Errorf("action[%d] type: want %s, got %s", i, actions[i].ActionType, loaded[i].ActionType)
		}
	}
}

func TestLoadTranscriptRejectsMalformedLine(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.jsonl")
	if err := os.WriteFile(path, []byte("not json\n"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := loadTranscript(path); err == nil {
		t.Error("want error on malformed JSON line; got nil")
	}
}
