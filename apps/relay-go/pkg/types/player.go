package types

// ParticipationStatus is the per-player lifecycle within one session.
type ParticipationStatus string

const (
	StatusInvited      ParticipationStatus = "invited"
	StatusJoined       ParticipationStatus = "joined"
	StatusReady        ParticipationStatus = "ready"
	StatusActive       ParticipationStatus = "active"
	StatusFolded       ParticipationStatus = "folded"
	StatusSettled      ParticipationStatus = "settled"
	StatusDisconnected ParticipationStatus = "disconnected"
	StatusTimedOut     ParticipationStatus = "timed_out"
	StatusForfeited    ParticipationStatus = "forfeited"
)

// PlayerState is one player's view in one session.
type PlayerState struct {
	Seat                Seat                `json:"seat"`
	PlayerId            PlayerId            `json:"player_id,omitempty"`
	ValueSigningPubkey  Pubkey33            `json:"value_signing_pubkey"`
	ParticipationStatus ParticipationStatus `json:"participation_status"`
	StakeAtRisk         Satoshis            `json:"stake_at_risk"`
	StakeOutpoint       Outpoint            `json:"stake_outpoint,omitempty"`
	EntropyCommitted      bool      `json:"entropy_committed"`
	EntropyCommitmentHash Hash256   `json:"entropy_commitment_hash,omitempty"`
	EntropyRevealed       bool      `json:"entropy_revealed"`
	EntropyValue          Hash256   `json:"entropy_value,omitempty"`
	ConcealedCardRefs   []Outpoint          `json:"concealed_card_refs"`
	DefaultPreferences  map[string]string   `json:"default_preferences"`
}
