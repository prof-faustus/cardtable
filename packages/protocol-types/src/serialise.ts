/**
 * Canonical state-hash computation per `spec/serialisation.md` §5.
 *
 *   stateHash = SHA-256( type_tag(0x0009) || canonical_encoding(state) )
 *
 * with `state.state_hash` itself encoded as 32 zero bytes inside the
 * hashed input. Two honest implementations MUST produce byte-identical
 * outputs for the same logical input — the cross-language conformance
 * vector at `spec/test-vectors/state-hash.json` is the binding surface.
 *
 * Encoding rules (subset; full reference at `spec/serialisation.md`):
 *  - u8 / u16-LE / u32-LE / u64-LE: raw little-endian
 *  - varint:  Bitcoin-style (1, 3, 5, 9 bytes)
 *  - bytes32: 32 raw bytes
 *  - string:  varint(byte_len) || utf8 bytes (no NUL terminator)
 *  - bool:    1 byte (0 / 1)
 *  - optional<T>: bool(present) followed by T's encoding when present
 *  - array<T>:    varint(count) followed by each element in order
 *
 * Hashes are domain-separated by their type tag (`spec/serialisation.md` §4).
 */

import type { Hash256, RoundState } from './index.js';
import { asHash256 } from './primitives.js';

const TAG_PLAYER = 0x0002;
const TAG_ROUNDSTATE = 0x0009;
const ROUNDSTATE_VERSION = 1;
const PLAYER_VERSION = 1;

const ZERO_32 = new Uint8Array(32);

// -- primitive encoders ------------------------------------------------------

function encU8(n: number): Uint8Array {
  return new Uint8Array([n & 0xff]);
}
function encU16LE(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}
function encU32LE(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}
function encU64LE(n: number | bigint): Uint8Array {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, v, true);
  return out;
}
function encBool(b: boolean): Uint8Array {
  return new Uint8Array([b ? 1 : 0]);
}
function encVarint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 0xfd;
    out[1] = n & 0xff;
    out[2] = (n >>> 8) & 0xff;
    return out;
  }
  if (n <= 0xffffffff) {
    const out = new Uint8Array(5);
    out[0] = 0xfe;
    new DataView(out.buffer).setUint32(1, n >>> 0, true);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = 0xff;
  new DataView(out.buffer).setBigUint64(1, BigInt(n), true);
  return out;
}
function encString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  return concat(encVarint(bytes.byteLength), bytes);
}
function encBytes32Hex(h: Hash256 | string): Uint8Array {
  const hex = String(h);
  if (hex.length !== 64) throw new Error(`encBytes32Hex: expected 64 hex chars, got ${hex.length}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`encBytes32Hex: bad hex at ${i * 2}: ${hex}`);
    out[i] = byte;
  }
  return out;
}
function encOptionalHash(h: Hash256 | null): Uint8Array {
  return h === null ? encBool(false) : concat(encBool(true), encBytes32Hex(h));
}
function encOptionalU32(n: number | null): Uint8Array {
  return n === null ? encBool(false) : concat(encBool(true), encU32LE(n));
}
function encOptionalSeat(n: number | null): Uint8Array {
  return n === null ? encBool(false) : concat(encBool(true), encU32LE(n));
}
function encOptionalString(s: string | undefined): Uint8Array {
  return s === undefined || s === '' ? encBool(false) : concat(encBool(true), encString(s));
}
function encArrayBytes32(items: readonly (Hash256 | string)[]): Uint8Array {
  const parts: Uint8Array[] = [encVarint(items.length)];
  for (const h of items) parts.push(encBytes32Hex(h));
  return concat(...parts);
}
function encArrayString(items: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [encVarint(items.length)];
  for (const s of items) parts.push(encString(s));
  return concat(...parts);
}
function concat(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

// -- composite encoders ------------------------------------------------------

function encPlayer(p: RoundState['players'][number]): Uint8Array {
  return concat(
    encU16LE(TAG_PLAYER),
    encU8(PLAYER_VERSION),
    encU32LE(p.seat),
    encBytes32Hex(p.player_id),
    encBytes32Hex(p.value_signing_pubkey.substring(p.value_signing_pubkey.length - 64)), // tail 32 bytes
    encString(p.participation_status),
    encU64LE(p.stake_at_risk),
    encOptionalString(p.stake_outpoint),
    encBool(p.entropy_committed),
    encOptionalHash(p.entropy_commitment_hash),
    encBool(p.entropy_revealed),
    encOptionalHash(p.entropy_value),
    encArrayString([...p.concealed_card_refs]),
    encPreferences(p.default_preferences),
  );
}

function encPreferences(prefs: Readonly<Record<string, string>>): Uint8Array {
  const keys = Object.keys(prefs).sort(); // canonical comparator: lex byte order
  const parts: Uint8Array[] = [encVarint(keys.length)];
  for (const k of keys) {
    parts.push(encString(k));
    parts.push(encString(prefs[k] ?? ''));
  }
  return concat(...parts);
}

function encVisibleCards(cards: RoundState['visible_cards']): Uint8Array {
  const parts: Uint8Array[] = [encVarint(cards.length)];
  for (const c of cards) parts.push(encU8(c.ordinal));
  return concat(...parts);
}

/**
 * Canonical encoding of a RoundState, with the state_hash field
 * replaced by 32 zero bytes (so the hash can be embedded recursively
 * without circularity).
 */
export function encodeRoundState(state: RoundState): Uint8Array {
  const playersParts: Uint8Array[] = [encVarint(state.players.length)];
  for (const p of state.players) playersParts.push(encPlayer(p));
  return concat(
    encU16LE(TAG_ROUNDSTATE),
    encU8(ROUNDSTATE_VERSION),
    encString(state.state_class),
    encBytes32Hex(state.game_id),
    encBytes32Hex(state.rule_set_hash),
    encU32LE(state.round_number),
    encOptionalSeat(state.acting_player_seat),
    concat(...playersParts),
    encU64LE(state.pot_value),
    encVisibleCards(state.visible_cards),
    encArrayBytes32(state.hidden_commitment_refs),
    encArrayString([...state.allowed_actions]),
    encOptionalU32(state.decision_deadline_block_height),
    encOptionalU32(state.recovery_deadline_block_height),
    encArrayBytes32(state.successor_template_hashes),
    encOptionalHash(state.combined_entropy),
    encOptionalHash(state.deck_commitment_hash),
    encOptionalHash(state.prior_state_hash),
    ZERO_32, // state_hash placeholder (self-reference)
  );
}

/**
 * Compute the canonical state hash. Pure async (Web Crypto's
 * SubtleCrypto.digest is async).
 */
export async function computeStateHash(state: RoundState): Promise<Hash256> {
  const encoded = encodeRoundState(state);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return asHash256(toHex(new Uint8Array(digest)));
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.byteLength; i++) {
    s += (b[i] as number).toString(16).padStart(2, '0');
  }
  return s;
}

/**
 * Verify that two consecutive states chain correctly: the second's
 * `prior_state_hash` MUST equal `computeStateHash(first)`.
 *
 * The initial state of a session chains from `null`.
 */
export async function chainsFromHash(
  prior: RoundState | null,
  next: RoundState,
): Promise<boolean> {
  if (prior === null) return next.prior_state_hash === null;
  if (next.prior_state_hash === null) return false;
  const expected = await computeStateHash(prior);
  return next.prior_state_hash === expected;
}
