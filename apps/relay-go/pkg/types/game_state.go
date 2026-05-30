package types

// StateClass enumerates every node class of the state machine.
type StateClass string

const (
	StateTableOpen           StateClass = "S0_TABLE_OPEN"
	StateSeatOpen            StateClass = "S1_SEAT_OPEN"
	StateTableLocked         StateClass = "S2_TABLE_LOCKED"
	StateEntropyCommit       StateClass = "S3_ENTROPY_COMMIT_WINDOW"
	StateEntropyReveal       StateClass = "S4_ENTROPY_REVEAL_WINDOW"
	StateDeckCommitted       StateClass = "S5_DECK_COMMITTED"
	StateCardRevealFirst     StateClass = "S6_CARD_REVEAL_FIRST"
	StateCardRevealSecond    StateClass = "S7_CARD_REVEAL_SECOND"
	StateBetDecision         StateClass = "S8_BET_DECISION"
	StateCardRevealThird     StateClass = "S9_CARD_REVEAL_THIRD"
	StateSettledRound        StateClass = "S10_SETTLED_ROUND"
	StateRotateTurn          StateClass = "S11_ROTATE_TURN"
	StateTableClose          StateClass = "S12_TABLE_CLOSE"
	StateRecovered           StateClass = "RECOVERED"
)

// LifecycleStatus is the GameInstance top-level state. Useful for
// indexers; the state engine itself works on RoundState.
type LifecycleStatus string

const (
	LifecycleOpen       LifecycleStatus = "open"
	LifecycleLocked     LifecycleStatus = "locked"
	LifecycleShuffling  LifecycleStatus = "shuffling"
	LifecycleDealing    LifecycleStatus = "dealing"
	LifecycleActive     LifecycleStatus = "active"
	LifecycleSettling   LifecycleStatus = "settling"
	LifecycleClosed     LifecycleStatus = "closed"
	LifecycleRecovered  LifecycleStatus = "recovered"
)

// RoundState is the canonical state object committed at every node of
// the protocol's transaction tree. Two honest engines must compute
// byte-identical encodings for the same logical input.
type RoundState struct {
	StateClass                  StateClass     `json:"state_class"`
	GameId                      GameId         `json:"game_id"`
	RuleSetHash                 RuleSetHash    `json:"rule_set_hash,omitempty"`
	RoundNumber                 RoundNumber    `json:"round_number"`
	ActingPlayerSeat            *Seat          `json:"acting_player_seat"`
	Players                     []PlayerState  `json:"players"`
	PotValue                    Satoshis       `json:"pot_value"`
	VisibleCards                []RevealedCard `json:"visible_cards"`
	HiddenCommitmentRefs        []Hash256      `json:"hidden_commitment_refs"`
	AllowedActions              []ActionType   `json:"allowed_actions"`
	DecisionDeadlineBlockHeight *BlockHeight   `json:"decision_deadline_block_height"`
	RecoveryDeadlineBlockHeight *BlockHeight   `json:"recovery_deadline_block_height"`
	SuccessorTemplateHashes     []Hash256      `json:"successor_template_hashes"`
	PriorStateHash              *Hash256       `json:"prior_state_hash"`
	StateHash                   Hash256        `json:"state_hash"`
}

// GameInstance is a session-level summary. Indexers use this; the
// engine operates on RoundState.
type GameInstance struct {
	GameId             GameId           `json:"game_id"`
	RuleSetHash        RuleSetHash      `json:"rule_set_hash"`
	PlayerList         []PlayerState    `json:"player_list"`
	TurnOrder          []Seat           `json:"turn_order"`
	CurrentRoundNumber RoundNumber      `json:"current_round_number"`
	CurrentStateHash   Hash256          `json:"current_state_hash"`
	LifecycleStatus    LifecycleStatus  `json:"lifecycle_status"`
}
