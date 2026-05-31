/**
 * Cryptographic verification gate.
 *
 * The pure engine (`applyAction`) is deliberately sync and crypto-
 * agnostic. This async wrapper is the layer where reveals are
 * actually verified against their prior commitments. A relay or
 * client should call `verifyAndApply` rather than `applyAction`
 * directly when ingesting an action from a peer.
 */

import {
  buildDeckCommitment,
  combineEntropy,
  commitEntropy,
  constantTimeEquals,
  fromHex,
  toHex,
  verifyRevealProof,
} from '@cardtable/crypto-cards';
import type {
  BlockHeight,
  ProtocolError,
  Result,
  RoundState,
  RuleSet,
  SignedAction,
} from '@cardtable/protocol-types';
import { asHash256, err, ok, protocolError } from '@cardtable/protocol-types';
import { applyAction } from './engine.js';

/**
 * Run the crypto pre-check, then delegate to the pure engine.
 *
 * - For EntropyCommit: validates that `commitment_hash` is well-formed
 *   64-char hex; no semantic check is possible until reveal.
 * - For EntropyReveal: looks up the prior commitment stored on the
 *   acting player's PlayerState; verifies the revealed plaintext
 *   hashes back to it; rejects with INVALID_REVEAL_PROOF otherwise.
 *
 * CardReveal verification against the on-chain deck commitment is
 * intentionally deferred until S5 stores the per-position commitments
 * (Phase 4.3).
 */
export async function verifyAndApply(
  state: RoundState,
  action: SignedAction,
  ruleSet: RuleSet,
  currentHeight: BlockHeight,
): Promise<Result<RoundState, ProtocolError>> {
  if (action.action_type === 'EntropyCommit') {
    const hash = action.commitment_hash;
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      return err(protocolError('INVALID_SIGNATURE', 'commitment_hash must be 64-char hex'));
    }
  }
  if (action.action_type === 'EntropyReveal') {
    if (action.acting_player_seat === null) {
      return err(protocolError('SEAT_OUT_OF_RANGE', 'EntropyReveal requires acting_player_seat'));
    }
    const seat = action.acting_player_seat;
    const player = state.players.find((p) => p.seat === seat);
    if (player === undefined) {
      return err(protocolError('PLAYER_NOT_SEATED', `seat ${seat}`));
    }
    const stored = player.entropy_commitment_hash;
    if (stored === null) {
      return err(protocolError('INVALID_STATE_TRANSITION', 'no prior commitment for this seat'));
    }
    if (!/^[0-9a-f]{64}$/.test(action.entropy)) {
      return err(protocolError('INVALID_REVEAL_PROOF', 'entropy must be 64-char hex'));
    }

    const commitmentBytes = fromHex(stored);
    const entropyBytes = fromHex(action.entropy);
    // The 33-byte compressed pubkey carries a 32-byte body — take the
    // tail to feed the 32-byte player_id input.
    const pubkeyBytes = fromHex(player.value_signing_pubkey);
    if (pubkeyBytes.byteLength < 32) {
      return err(protocolError('SERIALISATION_ERROR', 'player pubkey shorter than 32 bytes'));
    }
    const playerIdBytes = pubkeyBytes.subarray(pubkeyBytes.byteLength - 32);
    const gameIdBytes = fromHex(state.game_id);
    if (gameIdBytes.byteLength !== 32) {
      return err(protocolError('SERIALISATION_ERROR', 'game_id is not 32 bytes'));
    }
    const recomputed = await commitEntropy(entropyBytes, playerIdBytes, gameIdBytes);
    if (!constantTimeEquals(recomputed, commitmentBytes)) {
      return err(protocolError('INVALID_REVEAL_PROOF', 'entropy does not match prior commitment'));
    }
  }
  if (action.action_type === 'CardReveal') {
    if (state.combined_entropy === null) {
      return err(protocolError('INVALID_STATE_TRANSITION', 'no combined entropy yet'));
    }
    const combined = fromHex(state.combined_entropy);
    const dc = await buildDeckCommitment(combined, ruleSet.deck_format, ruleSet.shuffle_algorithm_version);
    const position = action.reveal.position;
    if (position < 0 || position >= dc.perPosition.length) {
      return err(protocolError('INVALID_REVEAL_PROOF', `position ${position} out of range`));
    }
    const expectedCommit = dc.perPosition[position]!.commitment;
    const proofOk = await verifyRevealProof(expectedCommit, {
      position: action.reveal.position,
      ordinal: action.reveal.revealed_card.ordinal,
      cardNonce: fromHex(action.reveal.card_nonce),
      deckNonce: fromHex(action.reveal.deck_nonce),
    });
    if (!proofOk) {
      return err(protocolError('INVALID_REVEAL_PROOF', 'card reveal does not match deck commitment'));
    }
  }

  const result = applyAction(state, action, ruleSet, currentHeight);
  if (!result.ok) return result;

  // Materialise the deck commitment on the S4 -> S5 transition: this
  // is the moment the verifiable shuffle becomes binding for every
  // honest engine that sees the transcript.
  if (
    state.state_class === 'S4_ENTROPY_REVEAL_WINDOW' &&
    result.value.state_class === 'S5_DECK_COMMITTED' &&
    result.value.combined_entropy === null
  ) {
    return ok(await materialiseDeckCommitment(result.value, ruleSet));
  }
  return result;
}

async function materialiseDeckCommitment(state: RoundState, ruleSet: RuleSet): Promise<RoundState> {
  const seatSorted = [...state.players].sort((a, b) => a.seat - b.seat);
  const entropies: Uint8Array[] = [];
  for (const p of seatSorted) {
    if (p.entropy_value === null) {
      // Should not happen — we only enter S5 once every reveal has
      // landed. Guard anyway.
      return state;
    }
    entropies.push(fromHex(p.entropy_value));
  }
  const combined = await combineEntropy(entropies);
  const dc = await buildDeckCommitment(
    combined,
    ruleSet.deck_format,
    ruleSet.shuffle_algorithm_version,
  );
  return {
    ...state,
    combined_entropy: asHash256(toHex(combined)),
    deck_commitment_hash: asHash256(toHex(dc.deckCommitmentHash)),
  };
}

