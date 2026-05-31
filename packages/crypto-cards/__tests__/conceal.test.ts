/**
 * Tests for per-card concealment (Phase 4 extended).
 *
 * Properties exercised:
 *   - encrypt then decrypt round-trips the plaintext byte-for-byte
 *   - a different holder's private key cannot decrypt (AES-GCM
 *     auth tag fails)
 *   - tampering with the ciphertext aborts decryption
 *   - each encryption picks a fresh ephemeral keypair, so the
 *     same (plaintext, holder) pair yields different ciphertexts
 */

import { describe, expect, it } from 'vitest';
import * as secp from '@noble/secp256k1';
import { decryptForHolder, encryptForHolder } from '../src/index.js';

function makeKeypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = secp.utils.randomPrivateKey();
  const pub = secp.getPublicKey(priv, true);
  return { priv, pub };
}

describe('conceal — ECIES envelope for per-card payloads', () => {
  it('decryptForHolder reproduces the plaintext given the matching private key', async () => {
    const holder = makeKeypair();
    const plaintext = new TextEncoder().encode('ace of spades');
    const env = await encryptForHolder(plaintext, holder.pub);

    expect(env.ephemeralPubkey.byteLength).toBe(33);
    expect(env.nonce.byteLength).toBe(12);
    expect(env.ciphertext.byteLength).toBe(plaintext.byteLength + 16); // GCM tag = 16 bytes

    const recovered = await decryptForHolder(env, holder.priv);
    expect(new TextDecoder().decode(recovered)).toBe('ace of spades');
  });

  it('rejects decryption with a different holder key', async () => {
    const alice = makeKeypair();
    const mallory = makeKeypair();
    const env = await encryptForHolder(new TextEncoder().encode('hello'), alice.pub);
    await expect(decryptForHolder(env, mallory.priv)).rejects.toBeDefined();
  });

  it('rejects ciphertext tampering (AES-GCM auth tag failure)', async () => {
    const holder = makeKeypair();
    const env = await encryptForHolder(new TextEncoder().encode('hello'), holder.pub);
    const tampered = { ...env, ciphertext: new Uint8Array(env.ciphertext) };
    tampered.ciphertext[0] ^= 0xff;
    await expect(decryptForHolder(tampered, holder.priv)).rejects.toBeDefined();
  });

  it('produces a fresh ephemeral keypair per call (non-deterministic ciphertext)', async () => {
    const holder = makeKeypair();
    const a = await encryptForHolder(new TextEncoder().encode('x'), holder.pub);
    const b = await encryptForHolder(new TextEncoder().encode('x'), holder.pub);
    // Ephemeral pubkeys differ; ciphertexts therefore differ.
    expect(Array.from(a.ephemeralPubkey)).not.toEqual(Array.from(b.ephemeralPubkey));
    expect(Array.from(a.ciphertext)).not.toEqual(Array.from(b.ciphertext));
  });

  it('handles a card-ordinal payload (the immediate next use case)', async () => {
    const holder = makeKeypair();
    const ordinal = 37;
    const plaintext = new Uint8Array([ordinal]);
    const env = await encryptForHolder(plaintext, holder.pub);
    const recovered = await decryptForHolder(env, holder.priv);
    expect(recovered.byteLength).toBe(1);
    expect(recovered[0]).toBe(ordinal);
  });
});
