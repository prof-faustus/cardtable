// Package types holds the Go protocol type definitions and the typed
// ErrorCode set. This package is the Go peer of the TypeScript
// `@cardtable/protocol-types` package and must produce identical
// canonical encodings for every input shared by the spec test
// vectors.
package types

// ErrorCode enumerates every protocol-level rejection reason. The set
// is shared with the TypeScript implementation; new codes are added in
// both implementations simultaneously so the test vectors remain
// portable.
type ErrorCode string

const (
	ErrInvalidStakeAmount      ErrorCode = "INVALID_STAKE_AMOUNT"
	ErrInvalidRevealProof      ErrorCode = "INVALID_REVEAL_PROOF"
	ErrInvalidTxConformance    ErrorCode = "INVALID_TX_CONFORMANCE"
	ErrInvalidSignature        ErrorCode = "INVALID_SIGNATURE"
	ErrInvalidStateTransition  ErrorCode = "INVALID_STATE_TRANSITION"
	ErrInvalidActionForState   ErrorCode = "INVALID_ACTION_FOR_STATE"
	ErrInvalidBetAmount        ErrorCode = "INVALID_BET_AMOUNT"
	ErrInvalidSuccessorTpl     ErrorCode = "INVALID_SUCCESSOR_TEMPLATE"
	ErrInvalidRuleSet          ErrorCode = "INVALID_RULE_SET"
	ErrStaleState              ErrorCode = "STALE_STATE"
	ErrStateNotFound           ErrorCode = "STATE_NOT_FOUND"
	ErrDoubleSpendConflict     ErrorCode = "DOUBLE_SPEND_CONFLICT"
	ErrTimeoutNotMature        ErrorCode = "TIMEOUT_NOT_MATURE"
	ErrRecoveryNotMature       ErrorCode = "RECOVERY_NOT_MATURE"
	ErrBadBinding              ErrorCode = "BAD_BINDING"
	ErrPlayerNotSeated         ErrorCode = "PLAYER_NOT_SEATED"
	ErrPlayerAlreadySeated     ErrorCode = "PLAYER_ALREADY_SEATED"
	ErrTableFull               ErrorCode = "TABLE_FULL"
	ErrTableNotLockable        ErrorCode = "TABLE_NOT_LOCKABLE"
	ErrSeatOutOfRange          ErrorCode = "SEAT_OUT_OF_RANGE"
	ErrSerialisation           ErrorCode = "SERIALISATION_ERROR"
	ErrUnsupportedVersion      ErrorCode = "UNSUPPORTED_VERSION"
)

// ProtocolError is the typed error returned by every fallible engine
// operation. The Code field is the conformance surface; Context is
// advisory.
type ProtocolError struct {
	Code    ErrorCode
	Context string
}

// Error returns a string representation suitable for log lines.
func (e *ProtocolError) Error() string {
	if e == nil {
		return ""
	}
	if e.Context == "" {
		return string(e.Code)
	}
	return string(e.Code) + ": " + e.Context
}

// NewProtocolError builds a typed protocol error. Use this rather than
// the bare struct so future changes (e.g. error wrapping) are
// localised.
func NewProtocolError(code ErrorCode, context string) *ProtocolError {
	return &ProtocolError{Code: code, Context: context}
}
