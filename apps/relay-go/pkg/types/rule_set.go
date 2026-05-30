package types

// GameType is the discriminant for the game family. v1 supports
// `in_between` only.
type GameType string

const (
	GameInBetween GameType = "in_between"
)

// PenaltySchedule names every protocol-level penalty by satoshi value.
type PenaltySchedule struct {
	NonReveal        Satoshis `json:"non_reveal"`
	BadReveal        Satoshis `json:"bad_reveal"`
	ConsecutiveCards Satoshis `json:"consecutive_cards"`
	EqualCards       Satoshis `json:"equal_cards"`
}

// SettlementRules names the multipliers and fixed penalties used when
// resolving In-Between rounds. Multipliers are integers; the
// fractional-multiplier case is out of scope for v1.
type SettlementRules struct {
	InBetweenWinMultiplier   int      `json:"in_between_win_multiplier"`
	InBetweenLossMultiplier  int      `json:"in_between_loss_multiplier"`
	ConsecutiveCardsPenalty  Satoshis `json:"consecutive_cards_penalty"`
	EqualCardsPenalty        Satoshis `json:"equal_cards_penalty"`
}

// RecoveryRules direct value distribution when the session enters the
// RECOVERED state class.
type RecoveryRules struct {
	RefundStakesToFunders   bool `json:"refund_stakes_to_funders"`
	ApplyNonRevealPenalty   bool `json:"apply_non_reveal_penalty"`
	ApplyBadRevealPenalty   bool `json:"apply_bad_reveal_penalty"`
}

// RuleSet is the agreed rule set for one session. Every field is
// required; silent defaults are a binding hazard because the rule set
// is hashed into every subsequent transaction's binding.
type RuleSet struct {
	GameType                 GameType           `json:"game_type"`
	PlayerCountMin           int                `json:"player_count_min"`
	PlayerCountMax           int                `json:"player_count_max"`
	StakeAmount              Satoshis           `json:"stake_amount"`
	MinBet                   Satoshis           `json:"min_bet"`
	MaxBet                   Satoshis           `json:"max_bet"`
	DecisionTimeoutBlocks    int                `json:"decision_timeout_blocks"`
	RecoveryTimeoutBlocks    int                `json:"recovery_timeout_blocks"`
	InvitationWindowBlocks   int                `json:"invitation_window_blocks"`
	DefaultActionByState     map[string]string  `json:"default_action_by_state"`
	PenaltySchedule          PenaltySchedule    `json:"penalty_schedule"`
	DeckFormat               int                `json:"deck_format"`
	ShuffleAlgorithmVersion  int                `json:"shuffle_algorithm_version"`
	SettlementRules          SettlementRules    `json:"settlement_rules"`
	RecoveryRules            RecoveryRules      `json:"recovery_rules"`
	SerialisationVersion     int                `json:"serialisation_version"`
}
