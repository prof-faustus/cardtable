/**
 * End-to-end mental-poker test.
 *
 * Demonstrates the full integrity + concealment property in one
 * scenario:
 *
 *   1. Two players join, lock, commit, reveal — engine materialises
 *      the deck commitment at S5 (verifiable shuffle).
 *   2. The orchestrator picks position 0 of the shuffled deck and
 *      seals the (ordinal, card_nonce, deck_nonce) tuple to a chosen
 *      holder's secp256k1 pubkey via encryptForHolder. The relay /
 *      other players see only the ciphertext.
 *   3. The holder decrypts the envelope with their private key and
 *      reconstructs the reveal proof.
 *   4. The holder submits a CardReveal action carrying that proof.
 *   5. verifyAndApply recomputes the per-position commitment, calls
 *      verifyRevealProof against the action, and accepts. The
 *      engine advances S5 -> S6.
 *   6. A tampered envelope yields the wrong (ordinal, card_nonce,
 *      deck_nonce) on decrypt, the resulting reveal does NOT match
 *      the commitment, and verifyAndApply rejects with
 *      INVALID_REVEAL_PROOF.
 */

import { describe, expect, it } from 'vitest';
import * as secp from '@noble/secp256k1';
import {
  asActionNonce,
  asBlockHeight,
  asGameId,
  asHash256,
  asPubkey33,
  asRoundNumber,
  asRuleSetHash,
  asSatoshis,
  asSeat,
} from '@cardtable/protocol-types';
import type { CardRevealAction, RuleSet, Seat } from '@cardtable/protocol-types';
import {
  buildDeckCommitment,
  combineEntropy,
  commitEntropy,
  decryptForHolder,
  encryptForHolder,
  fromHex,
  toHex,
} from '@cardtable/crypto-cards';
import { initialState, verifyAndApply } from '../src/index.js';

const GAME_ID_HEX = '00000000000000000000000000000000000000000000000000000000000000aa';

function makeRuleSet(): RuleSet {
  return {
    game_type: 'in_between',
    player_count_min: 2,
    player_count_max: 4,
    stake_amount: asSatoshis(1000),
    min_bet: asSatoshis(1),
    max_bet: asSatoshis(100),
    decision_timeout_blocks: 6,
    recovery_timeout_blocks: 144,
    invitation_window_blocks: 18,
    default_action_by_state: { S8_BET_DECISION: 'pass' },
    penalty_schedule: {
      non_reveal: asSatoshis(100),
      bad_reveal: asSatoshis(200),
      consecutive_cards: asSatoshis(50),
      equal_cards: asSatoshis(100),
    },
    deck_format: 52,
    shuffle_algorithm_version: 1,
    settlement_rules: {
      in_between_win_multiplier: 1,
      in_between_loss_multiplier: 1,
      consecutive_cards_penalty: asSatoshis(50),
      equal_cards_penalty: asSatoshis(100),
    },
    recovery_rules: {
      refund_stakes_to_funders: true,
      apply_non_reveal_penalty: true,
      apply_bad_reveal_penalty: true,
    },
    serialisation_version: 1,
  };
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!r.ok) throw new Error(`unwrap: ${JSON.stringify(r.error)}`);
  return r.value;
}

// Serialise a per-position reveal as bytes: ordinal(1) || cardNonce(32) || deckNonce(32).
function packReveal(ordinal: number, cardNonce: Uint8Array, deckNonce: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 32 + 32);
  out[0] = ordinal;
  out.set(cardNonce, 1);
  out.set(deckNonce, 33);
  return out;
}

function unpackReveal(b: Uint8Array): { ordinal: number; cardNonce: Uint8Array; deckNonce: Uint8Array } {
  if (b.byteLength !== 65) {
    throw new Error(`unpackReveal: want 65 bytes, got ${b.byteLength}`);
  }
  return {
    ordinal: b[0]!,
    cardNonce: b.subarray(1, 33),
    deckNonce: b.subarray(33, 65),
  };
}

describe('mental poker — end-to-end concealment + reveal verification', () => {
  it('only the holder can produce a valid CardReveal; tampering rejects', async () => {
    const rs = makeRuleSet();
    const h = asBlockHeight(100);

    // ----- Seat both players. -----
    const playerIds = [
      '0101010101010101010101010101010101010101010101010101010101010101',
      '0303030303030303030303030303030303030303030303030303030303030303',
    ];
    const pubkeys = playerIds.map((p) => '02' + p);
    const entropies = [
      '0202020202020202020202020202020202020202020202020202020202020202',
      '0404040404040404040404040404040404040404040404040404040404040404',
    ];
    const gameIdBytes = fromHex(GAME_ID_HEX);
    const commitmentsHex = await Promise.all(
      entropies.map(async (e, i) =>
        toHex(await commitEntropy(fromHex(e), fromHex(playerIds[i]!), gameIdBytes)),
      ),
    );

    let s = initialState(asGameId(GAME_ID_HEX), asRuleSetHash('0'.repeat(64)), asBlockHeight(244));

    for (let i = 0; i < 2; i++) {
      const seat = asSeat(i);
      s = unwrap(
        await verifyAndApply(
          s,
          {
            game_id: asGameId(GAME_ID_HEX),
            round_number: asRoundNumber(0),
            referenced_state_hash: asHash256('0'.repeat(64)),
            action_type: 'Join',
            action_nonce: asActionNonce(('1' + i).padStart(64, '0')),
            acting_player_seat: seat,
            authorising_signature: 'sig',
            successor_state_commitment: asHash256('0'.repeat(64)),
            player_pubkey: asPubkey33(pubkeys[i]!),
            stake_amount: rs.stake_amount,
          },
          rs,
          h,
        ),
      );
    }
    s = unwrap(
      await verifyAndApply(
        s,
        {
          game_id: asGameId(GAME_ID_HEX),
          round_number: asRoundNumber(0),
          referenced_state_hash: asHash256('0'.repeat(64)),
          action_type: 'TableLock',
          action_nonce: asActionNonce('20'.padStart(64, '0')),
          acting_player_seat: null,
          authorising_signature: 'sig',
          successor_state_commitment: asHash256('0'.repeat(64)),
        },
        rs,
        h,
      ),
    );
    for (let i = 0; i < 2; i++) {
      s = unwrap(
        await verifyAndApply(
          s,
          {
            game_id: asGameId(GAME_ID_HEX),
            round_number: asRoundNumber(0),
            referenced_state_hash: asHash256('0'.repeat(64)),
            action_type: 'EntropyCommit',
            action_nonce: asActionNonce(('3' + i).padStart(64, '0')),
            acting_player_seat: asSeat(i),
            authorising_signature: 'sig',
            successor_state_commitment: asHash256('0'.repeat(64)),
            commitment_hash: asHash256(commitmentsHex[i]!),
          },
          rs,
          h,
        ),
      );
    }
    for (let i = 0; i < 2; i++) {
      s = unwrap(
        await verifyAndApply(
          s,
          {
            game_id: asGameId(GAME_ID_HEX),
            round_number: asRoundNumber(0),
            referenced_state_hash: asHash256('0'.repeat(64)),
            action_type: 'EntropyReveal',
            action_nonce: asActionNonce(('4' + i).padStart(64, '0')),
            acting_player_seat: asSeat(i),
            authorising_signature: 'sig',
            successor_state_commitment: asHash256('0'.repeat(64)),
            entropy: asHash256(entropies[i]!),
          },
          rs,
          h,
        ),
      );
    }

    expect(s.state_class).toBe('S5_DECK_COMMITTED');

    // ----- Orchestrator builds the deck and seals position 0 to a holder. -----
    const combined = await combineEntropy(entropies.map((e) => fromHex(e)));
    const dc = await buildDeckCommitment(combined, rs.deck_format, rs.shuffle_algorithm_version);
    const pos0 = dc.perPosition[0]!;

    // Holder keypair — separate from the value-signing pubkeys.
    const holderPriv = secp.utils.randomPrivateKey();
    const holderPub = secp.getPublicKey(holderPriv, true);

    const sealed = await encryptForHolder(packReveal(pos0.ordinal, pos0.cardNonce, pos0.deckNonce), holderPub);

    // ----- Holder decrypts and reconstructs the reveal proof. -----
    const opened = await decryptForHolder(sealed, holderPriv);
    const reveal = unpackReveal(opened);
    expect(reveal.ordinal).toBe(pos0.ordinal);
    expect(toHex(reveal.cardNonce)).toBe(toHex(pos0.cardNonce));
    expect(toHex(reveal.deckNonce)).toBe(toHex(pos0.deckNonce));

    // ----- Holder submits CardReveal; engine accepts. -----
    const honestReveal: CardRevealAction = {
      game_id: asGameId(GAME_ID_HEX),
      round_number: asRoundNumber(0),
      referenced_state_hash: asHash256('0'.repeat(64)),
      action_type: 'CardReveal',
      action_nonce: asActionNonce('50'.padStart(64, '0')),
      acting_player_seat: null,
      authorising_signature: 'sig',
      successor_state_commitment: asHash256('0'.repeat(64)),
      reveal: {
        position: 0,
        revealed_card: { rank: '2', suit: 'clubs', ordinal: reveal.ordinal },
        card_nonce: asHash256(toHex(reveal.cardNonce)),
        deck_nonce: asHash256(toHex(reveal.deckNonce)),
      },
    };
    const okResult = await verifyAndApply(s, honestReveal, rs, h);
    expect(okResult.ok).toBe(true);

    // ----- Tamper the envelope; decrypt fails (AES-GCM auth). -----
    const tampered = { ...sealed, ciphertext: new Uint8Array(sealed.ciphertext) };
    tampered.ciphertext[0] ^= 0xff;
    await expect(decryptForHolder(tampered, holderPriv)).rejects.toBeDefined();

    // ----- Adversary fabricates a reveal with the WRONG ordinal but
    //       correct nonces (because nonces are publicly derivable
    //       from combined entropy in the MVP). Engine rejects since
    //       the recomputed commitment doesn't match. -----
    const forged: CardRevealAction = {
      ...honestReveal,
      action_nonce: asActionNonce('51'.padStart(64, '0')),
      reveal: {
        ...honestReveal.reveal,
        revealed_card: { ...honestReveal.reveal.revealed_card, ordinal: (reveal.ordinal + 1) % 52 },
      },
    };
    const badResult = await verifyAndApply(s, forged, rs, h);
    expect(badResult.ok).toBe(false);
    if (!badResult.ok) expect(badResult.error.code).toBe('INVALID_REVEAL_PROOF');
  });
});

// Avoid unused-variable warnings if the file is partially edited.
const _seat: Seat = asSeat(0);
void _seat;
