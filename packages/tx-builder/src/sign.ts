/**
 * ECDSA-signed input construction.
 *
 * Workflow:
 *   1. Caller builds an unsigned BsvTransaction (placeholder
 *      `unlockingScript` per input).
 *   2. For each input, caller calls `computeSighash` then
 *      `signSighash` to get a DER-encoded signature.
 *   3. Caller assembles the unlocking script (signature || hashType,
 *      then any preimage / pubkey pushes per the relevant
 *      script-template branch).
 *   4. Caller re-encodes the transaction with populated unlocking
 *      scripts.
 *
 * Uses @noble/secp256k1's bigint (r, s) outputs, then encodes them
 * into BIP-66 DER for on-chain consumption. Low-S normalisation is
 * mandatory on BSV (since 2015).
 */

import * as secp from '@noble/secp256k1';

/**
 * ECDSA-sign a 32-byte sighash digest with a 32-byte secp256k1
 * private key. Returns the DER-encoded signature (without the
 * 1-byte hashType suffix — the caller appends it).
 *
 * The signature is in low-S form per BIP-66.
 */
export async function signSighash(sighash: Uint8Array, privKey: Uint8Array): Promise<Uint8Array> {
  if (sighash.byteLength !== 32) {
    throw new Error(`signSighash: sighash must be 32 bytes, got ${sighash.byteLength}`);
  }
  if (privKey.byteLength !== 32) {
    throw new Error(`signSighash: privKey must be 32 bytes, got ${privKey.byteLength}`);
  }
  const sig = await secp.signAsync(sighash, privKey, { lowS: true });
  // @noble/secp256k1 v2 exposes r and s as bigints on the returned
  // signature object. Encode them into BIP-66 DER ourselves; this
  // avoids depending on any internal method name that has churned
  // across point releases.
  const r = bigintToBytes(sig.r);
  const s = bigintToBytes(sig.s);
  return encodeDer(r, s);
}

/**
 * Verify a DER-encoded ECDSA signature against a compressed
 * secp256k1 pubkey. Used by tests; not part of the on-chain script
 * logic (consensus verifies signatures via OP_CHECKSIG, which
 * speaks the same DER format internally).
 */
export async function verifySighashSignature(
  derSig: Uint8Array,
  sighash: Uint8Array,
  pubKey: Uint8Array,
): Promise<boolean> {
  if (sighash.byteLength !== 32) return false;
  if (pubKey.byteLength !== 33) return false;
  try {
    const { r, s } = decodeDer(derSig);
    // Reconstruct the 64-byte compact form (32 bytes r || 32 bytes s).
    const compact = new Uint8Array(64);
    compact.set(padTo32(r), 0);
    compact.set(padTo32(s), 32);
    return secp.verify(compact, sighash, pubKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers — BIP-66 DER encode / decode for (r, s)
// ---------------------------------------------------------------------------

function bigintToBytes(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.byteLength; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function padTo32(b: Uint8Array): Uint8Array {
  if (b.byteLength === 32) return b;
  if (b.byteLength > 32) {
    // Strip leading zero padding (a 33-byte input has a positive-sign
    // padding byte we don't need for the compact form).
    return b.slice(b.byteLength - 32);
  }
  const out = new Uint8Array(32);
  out.set(b, 32 - b.byteLength);
  return out;
}

function encodeDerInt(n: Uint8Array): Uint8Array {
  // Strip leading zero bytes...
  let i = 0;
  while (i < n.byteLength - 1 && n[i] === 0) i += 1;
  let body = n.slice(i);
  // ...then prepend one zero if the high bit is set (DER positive-int rule).
  if (((body[0] as number) & 0x80) !== 0) {
    const padded = new Uint8Array(body.byteLength + 1);
    padded[0] = 0x00;
    padded.set(body, 1);
    body = padded;
  }
  const out = new Uint8Array(2 + body.byteLength);
  out[0] = 0x02; // INTEGER tag
  out[1] = body.byteLength;
  out.set(body, 2);
  return out;
}

function encodeDer(r: Uint8Array, s: Uint8Array): Uint8Array {
  const rBytes = encodeDerInt(r);
  const sBytes = encodeDerInt(s);
  const out = new Uint8Array(2 + rBytes.byteLength + sBytes.byteLength);
  out[0] = 0x30; // SEQUENCE tag
  out[1] = rBytes.byteLength + sBytes.byteLength;
  out.set(rBytes, 2);
  out.set(sBytes, 2 + rBytes.byteLength);
  return out;
}

function decodeDer(buf: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  if (buf.byteLength < 8) throw new Error('decodeDer: too short');
  if (buf[0] !== 0x30) throw new Error('decodeDer: missing SEQUENCE tag');
  const seqLen = buf[1] as number;
  if (seqLen !== buf.byteLength - 2) throw new Error('decodeDer: length mismatch');
  let off = 2;
  if (buf[off] !== 0x02) throw new Error('decodeDer: missing r INTEGER tag');
  const rLen = buf[off + 1] as number;
  const r = buf.slice(off + 2, off + 2 + rLen);
  off += 2 + rLen;
  if (buf[off] !== 0x02) throw new Error('decodeDer: missing s INTEGER tag');
  const sLen = buf[off + 1] as number;
  const s = buf.slice(off + 2, off + 2 + sLen);
  return { r, s };
}
