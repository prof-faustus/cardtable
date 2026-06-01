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
 * `signSighash` uses @noble/secp256k1 with low-S enforcement
 * (mandatory on BSV since 2015).
 */

import * as secp from '@noble/secp256k1';

/**
 * ECDSA-sign a 32-byte sighash digest with a 32-byte secp256k1
 * private key. Returns the DER-encoded signature (without the 1-byte
 * hashType suffix — the caller appends it).
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
  return sig.toDERRawBytes();
}

/**
 * Verify a signed sighash against a compressed secp256k1 pubkey.
 * Used by tests; not part of the on-chain script logic (consensus
 * checks signatures via CHECKSIG).
 */
export async function verifySighashSignature(
  derSig: Uint8Array,
  sighash: Uint8Array,
  pubKey: Uint8Array,
): Promise<boolean> {
  if (sighash.byteLength !== 32) return false;
  if (pubKey.byteLength !== 33) return false;
  try {
    const sig = secp.Signature.fromDER(derSig);
    return secp.verify(sig, sighash, pubKey);
  } catch {
    return false;
  }
}
