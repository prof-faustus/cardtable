import { describe, expect, it } from 'vitest';
import * as secp from '@noble/secp256k1';
import {
  computeSighash,
  encodeBsvTransaction,
  SIGHASH_ALL_FORKID,
  signSighash,
  verifySighashSignature,
} from '@cardtable/tx-builder';
import {
  buildCooperativeTx,
  buildRecoveryTx,
  buildTimeoutTx,
  enumerateFallbackGraph,
  initialState,
  materialiseFallbackGraph,
} from '../src/index.js';
import {
  asBlockHeight,
  asGameId,
  asHash256,
  asPubkey33,
  asRuleSetHash,
  asSatoshis,
} from '@cardtable/protocol-types';
import type { RoundState, RuleSet } from '@cardtable/protocol-types';

const ZERO_32 = new Uint8Array(32);

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

function makeS8State(): RoundState {
  const base = initialState(asGameId('a'.repeat(64)), asRuleSetHash('b'.repeat(64)), asBlockHeight(244));
  return { ...base, state_class: 'S8_BET_DECISION' as const };
}

describe('tx-orchestrator — actual BSV transactions from fallback branches', () => {
  it('cooperative tx: sequence=FINAL, lockTime=0', () => {
    const tx = buildCooperativeTx({
      prev: { prevTxid: ZERO_32, prevVout: 0, prevValue: 1000n },
      successor: { value: 990n, lockingScript: new Uint8Array([0x51]) /* OP_1 */ },
    });
    expect(tx.inputs[0]?.sequence).toBe(0xffffffff);
    expect(tx.lockTime).toBe(0);
    expect(tx.outputs[0]?.value).toBe(990n);
  });

  it('timeout tx: sequence carries the relative-block delta; lockTime=0', () => {
    const rs = makeRuleSet();
    const branches = enumerateFallbackGraph(makeS8State(), rs);
    const built = materialiseFallbackGraph(branches, {
      decision_timeout_blocks: rs.decision_timeout_blocks,
      recovery_height: asBlockHeight(244),
      timeout_authorisers: [asPubkey33('02' + '11'.repeat(32)), asPubkey33('02' + '22'.repeat(32))],
      timeout_template_hash: asHash256('cc'.repeat(32)),
      recovery_signer: asPubkey33('02' + '33'.repeat(32)),
    });
    const timeoutBranch = built.find((b) => b.branch.kind === 'timeout')!;

    const tx = buildTimeoutTx({
      branch: timeoutBranch,
      prev: { prevTxid: ZERO_32, prevVout: 0, prevValue: 1000n },
      successor: { value: 990n, lockingScript: new Uint8Array([0x51]) },
    });
    expect(tx.inputs[0]?.sequence).toBe(rs.decision_timeout_blocks);
    expect(tx.lockTime).toBe(0);
  });

  it('recovery tx: lockTime=recovery_height; sequence < FINAL so lockTime is active', () => {
    const rs = makeRuleSet();
    const branches = enumerateFallbackGraph(makeS8State(), rs);
    const built = materialiseFallbackGraph(branches, {
      decision_timeout_blocks: rs.decision_timeout_blocks,
      recovery_height: asBlockHeight(244),
      timeout_authorisers: [asPubkey33('02' + '11'.repeat(32)), asPubkey33('02' + '22'.repeat(32))],
      timeout_template_hash: asHash256('cc'.repeat(32)),
      recovery_signer: asPubkey33('02' + '33'.repeat(32)),
    });
    const recoveryBranch = built.find((b) => b.branch.kind === 'recovery')!;

    const tx = buildRecoveryTx({
      branch: recoveryBranch,
      prev: { prevTxid: ZERO_32, prevVout: 0, prevValue: 1000n },
      successor: { value: 990n, lockingScript: new Uint8Array([0x51]) },
    });
    expect(tx.lockTime).toBe(244);
    expect(tx.inputs[0]?.sequence).toBeLessThan(0xffffffff);
  });

  it('signed cooperative tx: sighash → DER signature → verify round-trip', async () => {
    const tx = buildCooperativeTx({
      prev: { prevTxid: ZERO_32, prevVout: 0, prevValue: 1000n },
      successor: { value: 990n, lockingScript: new Uint8Array([0x51]) },
    });
    const priv = secp.utils.randomPrivateKey();
    const pub = secp.getPublicKey(priv, true);
    const prevScript = new Uint8Array([0x76, 0xa9, 0x00, 0x88, 0xac]);
    const sighash = await computeSighash({
      tx,
      inputIdx: 0,
      prevScript,
      prevValue: 1000n,
      hashType: SIGHASH_ALL_FORKID,
    });
    const der = await signSighash(sighash, priv);
    expect(await verifySighashSignature(der, sighash, pub)).toBe(true);

    // Re-encode the transaction (still unsigned in the script field —
    // tests don't assemble the unlocking script). The encoding must
    // be stable.
    const bytes = encodeBsvTransaction(tx);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
