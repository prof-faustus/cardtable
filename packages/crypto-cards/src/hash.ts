/**
 * Domain-separated SHA-256 hashing per `spec/serialisation.md` §5.
 *
 *   hash(object) = SHA-256( type_tag (u16 LE) || canonical_encoding(object) )
 *
 * Every commitment in the protocol uses this function; the leading
 * type-tag prevents cross-object collisions.
 */

import { concat, encodeU16LE } from './encode.js';

/** Canonical type tags used in this package. */
export const TAG_ENTROPY_COMMITMENT = 0x0005;
export const TAG_ENTROPY_REVEAL = 0x0006;
export const TAG_DECK_COMMITMENT = 0x0007;
export const TAG_CARD = 0x0008;
export const TAG_REVEAL_PROOF = 0x000c;

/**
 * Compute SHA-256 over the type tag (u16 LE) concatenated with the
 * supplied parts.
 */
export async function domainHash(typeTag: number, ...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const tag = encodeU16LE(typeTag);
  const input = concat(tag, ...parts);
  return sha256(input);
}

/** Raw SHA-256 — no domain separation. Used as the PRG primitive. */
export async function sha256(input: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer so the BufferSource type-check is
  // satisfied under TS 5.7+ (Uint8Array<ArrayBufferLike> is no longer
  // directly assignable to ArrayBufferView<ArrayBuffer>).
  const buf = new ArrayBuffer(input.byteLength);
  new Uint8Array(buf).set(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}
