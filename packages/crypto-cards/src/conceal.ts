/**
 * Per-card payload concealment for the extended one-UTXO-per-card
 * model (`spec/card-protocol.md` §6).
 *
 * Construction: ECIES-style envelope with secp256k1 ECDH +
 * HKDF-SHA-256 key derivation + AES-256-GCM AEAD.
 *
 *  envelope = {
 *    ephemeral_pubkey:   compressed secp256k1 pubkey (33 bytes)
 *    nonce:              12-byte AES-GCM IV
 *    ciphertext:         AES-256-GCM ciphertext || 16-byte auth tag
 *  }
 *
 * The relay never decrypts: it holds opaque envelopes and forwards
 * them. Only the holder of the corresponding secp256k1 private key
 * (`card_encryption_pubkey` per WalletIdentity) can open the
 * envelope.
 *
 * Note: secp256k1 is not part of the Web Crypto algorithm set, so
 * we lean on @noble/secp256k1 for the ECDH primitive and Web Crypto
 * SubtleCrypto for HKDF + AES-GCM. Both are present in modern
 * browsers and Node 20+.
 */

import * as secp from '@noble/secp256k1';
import { fromHex, toHex } from './encode.js';

/** One sealed concealed-card payload. */
export interface ConcealedEnvelope {
  /** Compressed secp256k1 pubkey, 33 bytes. */
  readonly ephemeralPubkey: Uint8Array;
  /** AES-GCM IV, 12 bytes. */
  readonly nonce: Uint8Array;
  /** AES-GCM ciphertext concatenated with the 16-byte auth tag. */
  readonly ciphertext: Uint8Array;
}

const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;

/**
 * Seal `plaintext` for the holder identified by their compressed
 * secp256k1 pubkey. A fresh ephemeral keypair is generated per call;
 * the ephemeral pubkey is published in the envelope, the ephemeral
 * private key is discarded.
 */
export async function encryptForHolder(
  plaintext: Uint8Array,
  holderPubkey: Uint8Array,
): Promise<ConcealedEnvelope> {
  if (holderPubkey.byteLength !== 33) {
    throw new Error(`encryptForHolder: holder pubkey must be 33 bytes, got ${holderPubkey.byteLength}`);
  }
  const ephemeralPriv = secp.utils.randomPrivateKey();
  const ephemeralPub = secp.getPublicKey(ephemeralPriv, true);
  const shared = ecdhSharedX(ephemeralPriv, holderPubkey);
  const key = await deriveAesKey(shared, ephemeralPub, holderPubkey);
  const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
  const ciphertext = await aesGcmEncrypt(key, nonce, plaintext);
  return { ephemeralPubkey: ephemeralPub, nonce, ciphertext };
}

/** Open an envelope addressed to `holderPriv` (32-byte scalar). */
export async function decryptForHolder(
  envelope: ConcealedEnvelope,
  holderPriv: Uint8Array,
): Promise<Uint8Array> {
  if (holderPriv.byteLength !== 32) {
    throw new Error(`decryptForHolder: holder private key must be 32 bytes, got ${holderPriv.byteLength}`);
  }
  if (envelope.ephemeralPubkey.byteLength !== 33) {
    throw new Error(`decryptForHolder: ephemeral pubkey must be 33 bytes`);
  }
  if (envelope.nonce.byteLength !== GCM_NONCE_BYTES) {
    throw new Error(`decryptForHolder: nonce must be ${GCM_NONCE_BYTES} bytes`);
  }
  const holderPub = secp.getPublicKey(holderPriv, true);
  const shared = ecdhSharedX(holderPriv, envelope.ephemeralPubkey);
  const key = await deriveAesKey(shared, envelope.ephemeralPubkey, holderPub);
  return aesGcmDecrypt(key, envelope.nonce, envelope.ciphertext);
}

/**
 * Static-DH shared secret as a 32-byte big-endian X-coordinate. Per
 * SEC 1 §3.3.1 the x-coordinate of the shared point is the canonical
 * ECDH shared secret.
 */
function ecdhSharedX(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  // @noble/secp256k1 returns 33-byte compressed point: 1-byte parity
  // prefix followed by the 32-byte x-coordinate. Drop the prefix.
  const shared = secp.getSharedSecret(priv, pub, true);
  return shared.slice(1);
}

/**
 * HKDF-SHA-256 expand the shared secret + per-message context into a
 * 32-byte AES-256 key.
 */
async function deriveAesKey(
  shared: Uint8Array,
  ephemeralPub: Uint8Array,
  holderPub: Uint8Array,
): Promise<CryptoKey> {
  const sharedBuf = toBuffer(shared);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    sharedBuf,
    'HKDF',
    false,
    ['deriveBits', 'deriveKey'],
  );
  const info = new Uint8Array(ephemeralPub.byteLength + holderPub.byteLength);
  info.set(ephemeralPub, 0);
  info.set(holderPub, ephemeralPub.byteLength);
  const salt = new TextEncoder().encode('cardtable/v1/conceal');
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBuffer(salt),
      info: toBuffer(info),
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_BYTES * 8 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function aesGcmEncrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    toBuffer(plaintext),
  );
  return new Uint8Array(ct);
}

async function aesGcmDecrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) },
    key,
    toBuffer(ciphertext),
  );
  return new Uint8Array(pt);
}

/** Copy a Uint8Array view into a plain ArrayBuffer (TS 5.7+ requires this for SubtleCrypto). */
function toBuffer(b: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(b.byteLength);
  new Uint8Array(buf).set(b);
  return buf;
}

// Convenience hex helpers for tests / debug output.
export const concealHex = { fromHex, toHex };
