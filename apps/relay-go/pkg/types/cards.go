package types

import "fmt"

// Suit and Rank are the canonical In-Between deck enums.
type Suit string
type Rank string

const (
	Clubs    Suit = "clubs"
	Diamonds Suit = "diamonds"
	Hearts   Suit = "hearts"
	Spades   Suit = "spades"
)

// Canonical orderings used by CardOrdinal / CardFromOrdinal.
var (
	SuitsInOrder = []Suit{Clubs, Diamonds, Hearts, Spades}
	RanksInOrder = []Rank{
		"2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
	}
)

// RevealedCard is a face-up card; `ordinal` is its canonical index.
type RevealedCard struct {
	Rank    Rank `json:"rank"`
	Suit    Suit `json:"suit"`
	Ordinal int  `json:"ordinal"`
}

// CardLifecycleState enumerates the extended one-UTXO-per-card states
// per spec/card-protocol.md §6.
//
// The named constants below are the canonical set every reference
// implementation supports. Game variants beyond In-Between MAY use
// additional string values (e.g. poker might emit "MUCKED" or
// "BURNT") — the engine only acts on the canonical states; unknown
// values pass through.
type CardLifecycleState string

const (
	CardUndealt           CardLifecycleState = "UNDEALT"
	CardAssignedConcealed CardLifecycleState = "ASSIGNED_CONCEALED"
	CardRevealed          CardLifecycleState = "REVEALED"
	CardSurrendered       CardLifecycleState = "SURRENDERED"
	CardRetired           CardLifecycleState = "RETIRED"
)

// CanonicalLifecycleStates is the named set every reference engine
// honours. Variant-specific states are permitted but not validated.
var CanonicalLifecycleStates = []CardLifecycleState{
	CardUndealt,
	CardAssignedConcealed,
	CardRevealed,
	CardSurrendered,
	CardRetired,
}

// ConcealedCard is one position's extended-model lifecycle row. The
// relay engine reads holder_pubkey + lifecycle_state for the Fold
// handler; the ciphertext / commitment / custody_outpoint fields
// are opaque blobs the orchestrator owns.
type ConcealedCard struct {
	CardCommitment  CardCommitment     `json:"card_commitment"`
	Ciphertext      string             `json:"ciphertext"`
	CustodyOutpoint Outpoint           `json:"custody_outpoint"`
	HolderPubkey    Pubkey33           `json:"holder_pubkey"`
	LifecycleState  CardLifecycleState `json:"lifecycle_state"`
}

// CardCommitment is the per-position deck commitment used by both the
// MVP commitment-based deck and the extended one-UTXO-per-card model.
type CardCommitment struct {
	Position       int     `json:"position"`
	CardCommitment Hash256 `json:"card_commitment"`
	CardNonce      Hash256 `json:"card_nonce"`
}

// RevealProof opens a card commitment at a specific deck position.
type RevealProof struct {
	Position     int          `json:"position"`
	RevealedCard RevealedCard `json:"revealed_card"`
	CardNonce    Hash256      `json:"card_nonce"`
	DeckNonce    Hash256      `json:"deck_nonce"`
}

// CardOrdinal computes the canonical 0..51 index for a (rank, suit).
func CardOrdinal(rank Rank, suit Suit) (int, error) {
	rIdx := -1
	for i, r := range RanksInOrder {
		if r == rank {
			rIdx = i
			break
		}
	}
	sIdx := -1
	for i, s := range SuitsInOrder {
		if s == suit {
			sIdx = i
			break
		}
	}
	if rIdx == -1 || sIdx == -1 {
		return 0, fmt.Errorf("CardOrdinal: invalid rank/suit (%s, %s)", rank, suit)
	}
	return 13*sIdx + rIdx, nil
}

// CardFromOrdinal is the inverse: recover the (rank, suit) for an
// ordinal 0..51.
func CardFromOrdinal(ordinal int) (RevealedCard, error) {
	if ordinal < 0 || ordinal > 51 {
		return RevealedCard{}, fmt.Errorf("CardFromOrdinal: ordinal out of 52-card range: %d", ordinal)
	}
	return RevealedCard{
		Rank:    RanksInOrder[ordinal%13],
		Suit:    SuitsInOrder[ordinal/13],
		Ordinal: ordinal,
	}, nil
}
