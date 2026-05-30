// Package wire is the binary frame codec for the cardtable wire
// protocol per spec/wire-protocol.md.
//
// All multi-byte integers are little-endian. The frame format is:
//
//	┌──────────┬─────────┬──────────┬────────────┬──────────┬─────────┐
//	│ Magic(4) │ Ver(2)  │ Type(2)  │ Length(4)  │ Chksum(4)│ Payload │
//	└──────────┴─────────┴──────────┴────────────┴──────────┴─────────┘
//
// Magic is the fixed bytes "CARD". Checksum is the first 4 bytes of
// SHA-256(payload) (single SHA-256, not double).
package wire

// Magic is the fixed 4-byte network identifier ("CARD" in ASCII).
var Magic = [4]byte{0x43, 0x41, 0x52, 0x44}

// Version1_0 is the protocol version `1.0` as encoded on the wire:
// high byte = major, low byte = minor.
const Version1_0 uint16 = 0x0100

// HeaderSize is the fixed 16-byte frame header size.
const HeaderSize = 16

// MaxPayloadSize is the 32 MiB payload cap from spec §1.
const MaxPayloadSize = 32 * 1024 * 1024

// MsgType is the 2-byte u16 type code from spec §3.
type MsgType uint16

// Discovery (§3.1).
const (
	MsgVersion MsgType = 0x0001
	MsgVerack  MsgType = 0x0002
	MsgPing    MsgType = 0x0003
	MsgPong    MsgType = 0x0004
	MsgGetaddr MsgType = 0x0005
	MsgAddr    MsgType = 0x0006
)

// Object relay (§3.2).
const (
	MsgInv      MsgType = 0x0100
	MsgGetdata  MsgType = 0x0101
	MsgObject   MsgType = 0x0102
	MsgNotFound MsgType = 0x0103
	MsgReject   MsgType = 0x0104
)

// Game objects (§3.3).
const (
	MsgTableAnnounce  MsgType = 0x0200
	MsgSeatCommit     MsgType = 0x0201
	MsgTableStart     MsgType = 0x0202
	MsgActionCommit   MsgType = 0x0203
	MsgActionReveal   MsgType = 0x0204
	MsgRoundResult    MsgType = 0x0205
	MsgTranscriptHash MsgType = 0x0206
	MsgTableClose     MsgType = 0x0207
	MsgTimeoutNotice  MsgType = 0x0208
)

// Client ↔ relay (§3.4).
const (
	MsgJoinTable          MsgType = 0x0300
	MsgReady              MsgType = 0x0301
	MsgAction             MsgType = 0x0302
	MsgCommitment         MsgType = 0x0303
	MsgReveal             MsgType = 0x0304
	MsgCardReveal         MsgType = 0x0305
	MsgFold               MsgType = 0x0306
	MsgTranscriptRequest  MsgType = 0x0307
	MsgTableState         MsgType = 0x0380
	MsgActionAccepted     MsgType = 0x0381
	MsgPeerAction         MsgType = 0x0382
	MsgTranscriptResponse MsgType = 0x0383
	MsgErrorReply         MsgType = 0x03FE
)

// RejectCode is the 1-byte enum from spec §8.
type RejectCode uint8

const (
	RejectMalformed         RejectCode = 0x01
	RejectInvalidChecksum   RejectCode = 0x02
	RejectUnsupportedVer    RejectCode = 0x03
	RejectMessageTooLarge   RejectCode = 0x04
	RejectUnknownType       RejectCode = 0x05
	RejectStaleObject       RejectCode = 0x06
	RejectDuplicateObject   RejectCode = 0x07
	RejectInvalidObjectHash RejectCode = 0x08
	RejectRateLimited       RejectCode = 0x09
	RejectBadBinding        RejectCode = 0x0A
)
