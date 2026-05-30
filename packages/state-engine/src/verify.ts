/**
 * Cryptographic verification gate.
 *
 * The pure engine (`applyAction`) is deliberately sync and crypto-
 * agnostic. This async wrapper is the layer where reveals are
 * actually verified against their prior commitments. A relay or
 * client should call `verifyAndApply` rather than `applyAction`
 * directly when ingesting an action from a peer.
 */

import { commitEntropy, constantTimeEquals, fromHex } from '@cardtable/crypto-cards';
import type {
  BlockHeight,
  ProtocolError,
  Result,
  RoundState,
  RuleSet,
  SignedAction,
} from '@cardtable/protocol-types';
import { err, ok, protocolError } from '@cardtable/protocol-types';
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
  return applyAction(state, action, ruleSet, currentHeight);
}
