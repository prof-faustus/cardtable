/**
 * Domain-separated SHA-256 hashing.
 *
 * Per `spec/serialisation.md` §5, every commitment hash in the protocol
 * is computed as `SHA-256(type_tag || canonical_encoding(object))`. The
 * type tag prevents cross-class collisions: a hash computed for one
 * object type cannot be misinterpreted as a hash of another.
 *
 * Implementation uses Web Crypto's `crypto.subtle` in browser builds and
 * Node 20+'s `node:crypto.webcrypto.subtle` on the server. We rely on
 * `globalThis.crypto.subtle` so callers do not need to import a node
 * binding.
 */

import type { Hash256 } from './primitives.js';

/** Type-tag constants per `spec/serialisation.md` §4. */
export const TYPE_TAG = {
  RULE_SET: 0x0001,
  PLAYER: 0x0002,
  WALLET_IDENTITY: 0x0003,
  GAME_INSTANCE: 0x0004,
  ENTROPY_COMMITMENT: 0x0005,
  ENTROPY_REVEAL: 0x0006,
  DECK_COMMITMENT: 0x0007,
  CARD: 0x0008,
  ROUND_STATE: 0x0009,
  SIGNED_ACTION: 0x000a,
  TIMEOUT_BRANCH: 0x000b,
  REVEAL_PROOF: 0x000c,
  SETTLEMENT_RESULT: 0x000d,
  RECOVERY_RECORD: 0x000e,
  AUDIT_TRANSCRIPT: 0x000f,
  TX_TEMPLATE_REF: 0x0010,
  BINDING_FIELDS: 0x0011,
  TABLE_STATE: 0x0012,
  POT_STATE: 0x0013,
  WIRE_FRAME: 0x0014,
} as const satisfies Readonly<Record<string, number>>;

export type TypeTag = (typeof TYPE_TAG)[keyof typeof TYPE_TAG];

/** Encode a 16-bit type tag as 2 little-endian bytes. */
function encodeTagLE(tag: TypeTag): Uint8Array {
  const out = new Uint8Array(2);
  out[0] = tag & 0xff;
  out[1] = (tag >> 8) & 0xff;
  return out;
}

/** Convert a Uint8Array to lowercase hex. */
export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const x = b[i];
    if (x === undefined) continue;
    s += x.toString(16).padStart(2, '0');
  }
  return s;
}

/** Convert lowercase hex to Uint8Array (rejects malformed input). */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new Error(`hexToBytes: malformed input`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    out[i] = byte;
  }
  return out;
}

/**
 * Compute the domain-separated SHA-256 of an object payload under a type tag.
 *
 * `hash(type_tag, payload) = SHA-256(LE16(type_tag) || payload)`
 */
export async function domainSha256(tag: TypeTag, payload: Uint8Array): Promise<Hash256> {
  const prefix = encodeTagLE(tag);
  const combined = new Uint8Array(prefix.length + payload.length);
  combined.set(prefix, 0);
  combined.set(payload, prefix.length);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', combined);
  const out = bytesToHex(new Uint8Array(digest));
  return out as Hash256;
}

/**
 * Synchronous variant for environments that have a synchronous SHA-256
 * (e.g. a polyfill or `node:crypto.createHash`). Throws on environments
 * without it. Prefer {@link domainSha256} when async is acceptable.
 */
export function domainSha256Sync(
  tag: TypeTag,
  payload: Uint8Array,
  hasher: (data: Uint8Array) => Uint8Array,
): Hash256 {
  const prefix = encodeTagLE(tag);
  const combined = new Uint8Array(prefix.length + payload.length);
  combined.set(prefix, 0);
  combined.set(payload, prefix.length);
  return bytesToHex(hasher(combined)) as Hash256;
}
