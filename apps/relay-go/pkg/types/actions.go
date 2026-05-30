package types

// ActionType is the discriminant tag of every protocol action.
type ActionType string

const (
	ActionJoin           ActionType = "Join"
	ActionEntropyCommit  ActionType = "EntropyCommit"
	ActionEntropyReveal  ActionType = "EntropyReveal"
	ActionCardReveal     ActionType = "CardReveal"
	ActionBet            ActionType = "BetAction"
	ActionPass           ActionType = "Pass"
	ActionFold           ActionType = "Fold"
	ActionSettle         ActionType = "Settle"
	ActionRotateTurn     ActionType = "RotateTurn"
	ActionTableLock      ActionType = "TableLock"
	ActionTableClose     ActionType = "TableClose"
	ActionTimeout        ActionType = "Timeout"
	ActionRecovery       ActionType = "Recovery"
)

// SignedAction is a single Go struct carrying every action variant's
// fields. Optional fields are zero-valued for variants that do not
// use them. We deliberately collapse the discriminated union here
// because Go's encoding/json does not natively support sum types and
// the unified shape is easier for the engine to dispatch on
// ActionType.
type SignedAction struct {
	GameId                    GameId      `json:"game_id"`
	RoundNumber               RoundNumber `json:"round_number"`
	ReferencedStateHash       Hash256     `json:"referenced_state_hash"`
	ActionType                ActionType  `json:"action_type"`
	ActionNonce               ActionNonce `json:"action_nonce"`
	ActingPlayerSeat          *Seat       `json:"acting_player_seat"` // pointer so JSON null is preserved
	AuthorisingSignature      string      `json:"authorising_signature"`
	SuccessorStateCommitment  Hash256     `json:"successor_state_commitment"`

	// Variant-specific fields. Zero-valued when not applicable.
	PlayerPubkey       Pubkey33    `json:"player_pubkey,omitempty"`
	StakeAmount        Satoshis    `json:"stake_amount,omitempty"`
	CommitmentHash     Hash256     `json:"commitment_hash,omitempty"`
	Entropy            Hash256     `json:"entropy,omitempty"`
	Reveal             RevealProof `json:"reveal"`
	BetAmount          Satoshis    `json:"bet_amount,omitempty"`
	DefaultConsequence ActionType  `json:"default_consequence,omitempty"`
	SilencedSeat       *Seat       `json:"silenced_seat,omitempty"`
	RecoveryTrigger    string      `json:"recovery_trigger,omitempty"`
}
