import { describe, it, expect } from 'vitest';
import {
  buildCardCustody,
  buildCardCustodyScript,
  buildEntropyCommit,
  buildEntropyCommitScript,
  buildFoldSurrender,
  buildFoldSurrenderScript,
  buildPotLock,
  buildPotLockScript,
  buildRecoveryBranch,
  buildRecoveryBranchTemplate,
  buildRevealProofScript,
  buildRoundState,
  buildRoundStateScript,
  buildSettleClaimScript,
  buildStakeLock,
  buildStakeLockScript,
  buildTableRoot,
  buildTableRootLockingScript,
  buildTimeoutBranch,
  buildTimeoutBranchScript,
  ScriptWriter,
  encodeScriptNum,
  bytesToHex,
  OP,
  opNumber,
} from '../src/index.js';
import {
  asBlockHeight,
  asHash256,
  asPubkey33,
} from '@cardtable/protocol-types';

const PUB_A = asPubkey33('02' + 'aa'.repeat(32));
const PUB_B = asPubkey33('02' + 'bb'.repeat(32));
const PUB_C = asPubkey33('02' + 'cc'.repeat(32));
const HASH_1 = asHash256('11'.repeat(32));
const HASH_2 = asHash256('22'.repeat(32));
const HEIGHT = asBlockHeight(244);

/**
 * Walk script opcodes properly so push-payload bytes are not
 * misclassified as opcodes. Skips data-push payloads of every PUSH
 * form (direct, PUSHDATA1, PUSHDATA2, PUSHDATA4).
 */
function listOpcodes(script: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < script.length) {
    const op = script[i];
    if (op === undefined) break;
    out.push(op);
    i++;
    if (op >= 0x01 && op <= 0x4b) {
      i += op;
    } else if (op === 0x4c) {
      const n = script[i];
      if (n === undefined) break;
      i += 1 + n;
    } else if (op === 0x4d) {
      const lo = script[i];
      const hi = script[i + 1];
      if (lo === undefined || hi === undefined) break;
      i += 2 + (lo | (hi << 8));
    } else if (op === 0x4e) {
      const a = script[i];
      const b = script[i + 1];
      const c = script[i + 2];
      const d = script[i + 3];
      if (a === undefined || b === undefined || c === undefined || d === undefined) break;
      i += 4 + ((a | (b << 8) | (c << 16) | (d << 24)) >>> 0);
    }
  }
  return out;
}

// Opcode bytes for the inert post-Genesis no-ops we forbid (0xb1 / 0xb2).
// Asserting their absence is a regression guard for the rule "no
// in-script timelock opcode anywhere."
const FORBIDDEN_OPCODES = [0xb1, 0xb2] as const;

function assertNoForbiddenOpcodes(script: Uint8Array): void {
  const ops = listOpcodes(script);
  for (const f of FORBIDDEN_OPCODES) {
    expect(ops).not.toContain(f);
  }
}

// ---------------------------------------------------------------------------
// opcode + writer primitives
// ---------------------------------------------------------------------------

describe('opNumber', () => {
  it('maps 0 -> OP_0', () => {
    expect(opNumber(0)).toBe(OP.OP_0);
  });
  it('maps 1..16 -> OP_1..OP_16', () => {
    for (let i = 1; i <= 16; i++) {
      expect(opNumber(i)).toBe(OP.OP_1 + i - 1);
    }
  });
  it('rejects values outside [0,16]', () => {
    expect(() => opNumber(17)).toThrow();
    expect(() => opNumber(-1)).toThrow();
  });
});

describe('encodeScriptNum', () => {
  it('encodes 0 as empty bytes', () => {
    expect(encodeScriptNum(0).length).toBe(0);
  });
  it('encodes small positives without sign byte', () => {
    expect(Array.from(encodeScriptNum(1))).toEqual([0x01]);
    expect(Array.from(encodeScriptNum(127))).toEqual([0x7f]);
  });
  it('appends 0x00 sign byte for positives with high-bit set', () => {
    expect(Array.from(encodeScriptNum(0x80))).toEqual([0x80, 0x00]);
    expect(Array.from(encodeScriptNum(0xff))).toEqual([0xff, 0x00]);
  });
  it('uses sign-magnitude for negatives', () => {
    expect(Array.from(encodeScriptNum(-1))).toEqual([0x81]);
    expect(Array.from(encodeScriptNum(-127))).toEqual([0xff]);
    expect(Array.from(encodeScriptNum(-128))).toEqual([0x80, 0x80]);
  });
});

describe('ScriptWriter.pushData minimal-push semantics', () => {
  it('empty -> OP_0', () => {
    const w = new ScriptWriter();
    w.pushData(new Uint8Array(0));
    expect(Array.from(w.bytes())).toEqual([OP.OP_0]);
  });
  it('single byte 1..16 -> OP_1..OP_16', () => {
    const w = new ScriptWriter();
    w.pushData(new Uint8Array([0x07]));
    expect(Array.from(w.bytes())).toEqual([OP.OP_1 + 6]);
  });
  it('single byte 0x81 -> OP_1NEGATE', () => {
    const w = new ScriptWriter();
    w.pushData(new Uint8Array([0x81]));
    expect(Array.from(w.bytes())).toEqual([OP.OP_1NEGATE]);
  });
  it('1..75 bytes -> [len][data]', () => {
    const w = new ScriptWriter();
    const data = new Uint8Array(70).fill(0xab);
    w.pushData(data);
    const got = Array.from(w.bytes());
    expect(got[0]).toBe(70);
    expect(got.slice(1)).toEqual(Array.from(data));
  });
  it('76..255 bytes -> OP_PUSHDATA1', () => {
    const w = new ScriptWriter();
    w.pushData(new Uint8Array(76).fill(0x5a));
    const got = Array.from(w.bytes());
    expect(got[0]).toBe(0x4c);
    expect(got[1]).toBe(76);
  });
  it('256..65535 bytes -> OP_PUSHDATA2', () => {
    const w = new ScriptWriter();
    w.pushData(new Uint8Array(300).fill(0x42));
    const got = Array.from(w.bytes());
    expect(got[0]).toBe(0x4d);
    expect(got[1]).toBe(300 & 0xff);
    expect(got[2]).toBe((300 >> 8) & 0xff);
  });
});

// ---------------------------------------------------------------------------
// Templates — structural checks + locktime branch table + no-inert-opcodes
// ---------------------------------------------------------------------------

describe('table-root template', () => {
  it('locking script is a single n-of-n CHECKMULTISIG with no in-script timelock', () => {
    const s = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_CHECKMULTISIG);
    expect(ops.filter((o) => o === OP.OP_CHECKMULTISIG).length).toBe(1);
    assertNoForbiddenOpcodes(s);
  });

  it('build returns branch table with cooperative + recovery branches', () => {
    const t = buildTableRoot({
      seated_pubkeys: [PUB_A, PUB_B],
      recovery_height: HEIGHT,
    });
    const names = t.branches.map((b) => b.name);
    expect(names).toEqual(['cooperative', 'recovery']);
    expect(t.branches[0]?.locktime.kind).toBe('immediate');
    expect(t.branches[1]?.locktime.kind).toBe('absolute_height');
    if (t.branches[1]?.locktime.kind === 'absolute_height') {
      expect(t.branches[1].locktime.not_before_height).toBe(HEIGHT);
    }
  });

  it('deterministic', () => {
    const a = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      recovery_height: HEIGHT,
    });
    const b = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      recovery_height: HEIGHT,
    });
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('rejects 0 pubkeys', () => {
    expect(() =>
      buildTableRootLockingScript({
        seated_pubkeys: [],
        recovery_height: HEIGHT,
      }),
    ).toThrow();
  });
});

describe('stake-lock template', () => {
  it('three branches present and no in-script timelock', () => {
    const s = buildStakeLockScript({
      player_pubkey: PUB_A,
      operator_pubkey: PUB_B,
      expected_settlement_hash: HASH_1,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_CHECKMULTISIG); // cooperative
    expect(ops).toContain(OP.OP_HASH256); // winner claim
    expect(ops.filter((o) => o === OP.OP_CHECKSIG).length).toBeGreaterThanOrEqual(2); // claim + refund
    assertNoForbiddenOpcodes(s);
  });

  it('build returns cooperative + winner_claim + refund branches', () => {
    const t = buildStakeLock({
      player_pubkey: PUB_A,
      operator_pubkey: PUB_B,
      expected_settlement_hash: HASH_1,
      recovery_height: HEIGHT,
    });
    expect(t.branches.map((b) => b.name)).toEqual([
      'cooperative',
      'winner_claim',
      'refund',
    ]);
    expect(t.branches[2]?.locktime.kind).toBe('absolute_height');
  });

  it('deterministic', () => {
    const a = buildStakeLockScript({
      player_pubkey: PUB_A,
      operator_pubkey: PUB_B,
      expected_settlement_hash: HASH_1,
      recovery_height: HEIGHT,
    });
    const b = buildStakeLockScript({
      player_pubkey: PUB_A,
      operator_pubkey: PUB_B,
      expected_settlement_hash: HASH_1,
      recovery_height: HEIGHT,
    });
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });
});

describe('pot-lock template', () => {
  it('contains cooperative + winner-claim + refund opcodes; no in-script timelock', () => {
    const s = buildPotLockScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      winner_proof_hash: HASH_2,
      winner_pubkey: PUB_A,
      refund_pubkey: PUB_B,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_CHECKMULTISIG);
    expect(ops).toContain(OP.OP_SHA256);
    assertNoForbiddenOpcodes(s);
  });

  it('build returns cooperative + winner_claim + refund branches', () => {
    const t = buildPotLock({
      seated_pubkeys: [PUB_A, PUB_B],
      winner_proof_hash: HASH_2,
      winner_pubkey: PUB_A,
      refund_pubkey: PUB_B,
      recovery_height: HEIGHT,
    });
    expect(t.branches.map((b) => b.name)).toEqual([
      'cooperative',
      'winner_claim',
      'refund',
    ]);
  });
});

describe('entropy-commit template', () => {
  it('contains reveal + cooperative-fallback + refund branches; no in-script timelock', () => {
    const s = buildEntropyCommitScript({
      commitment_hash: HASH_1,
      player_pubkey: PUB_A,
      other_pubkeys: [PUB_B, PUB_C],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_SHA256);
    expect(ops).toContain(OP.OP_CHECKMULTISIG);
    expect(ops).toContain(OP.OP_CHECKSIG);
    assertNoForbiddenOpcodes(s);
  });

  it('build returns three branches with correct locktime specs', () => {
    const t = buildEntropyCommit({
      commitment_hash: HASH_1,
      player_pubkey: PUB_A,
      other_pubkeys: [PUB_B, PUB_C],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    expect(t.branches.map((b) => b.name)).toEqual([
      'reveal',
      'cooperative_fallback',
      'refund',
    ]);
    expect(t.branches[1]?.locktime.kind).toBe('relative_blocks');
    expect(t.branches[2]?.locktime.kind).toBe('absolute_height');
  });

  it('degenerates safely with empty other_pubkeys (always-fail cooperative)', () => {
    const s = buildEntropyCommitScript({
      commitment_hash: HASH_1,
      player_pubkey: PUB_A,
      other_pubkeys: [],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_RETURN);
    assertNoForbiddenOpcodes(s);
  });
});

describe('card-custody template', () => {
  it('contains reveal + fold + recovery branches; no in-script timelock', () => {
    const s = buildCardCustodyScript({
      face_commitment: HASH_1,
      holder_pubkey: PUB_A,
      original_funder_pubkey: PUB_B,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_HASH256); // reveal
    expect(ops).toContain(OP.OP_CHECKSIG);
    assertNoForbiddenOpcodes(s);
  });

  it('build returns reveal + fold_surrender + recovery_refund branches', () => {
    const t = buildCardCustody({
      face_commitment: HASH_1,
      holder_pubkey: PUB_A,
      original_funder_pubkey: PUB_B,
      recovery_height: HEIGHT,
    });
    expect(t.branches.map((b) => b.name)).toEqual([
      'reveal',
      'fold_surrender',
      'recovery_refund',
    ]);
  });
});

describe('round-state template', () => {
  it('three-way IF/ELSE: action + timeout + recovery; no in-script timelock', () => {
    const s = buildRoundStateScript({
      successor_template_hash: HASH_1,
      timeout_template_hash: HASH_2,
      acting_player_pubkey: PUB_A,
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    expect(ops.filter((o) => o === OP.OP_CHECKMULTISIG).length).toBe(2);
    expect(ops.filter((o) => o === OP.OP_HASH256).length).toBe(2);
    assertNoForbiddenOpcodes(s);
  });

  it('build returns action + timeout + recovery branches with right locktime kinds', () => {
    const t = buildRoundState({
      successor_template_hash: HASH_1,
      timeout_template_hash: HASH_2,
      acting_player_pubkey: PUB_A,
      seated_pubkeys: [PUB_A, PUB_B],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    expect(t.branches.map((b) => b.name)).toEqual([
      'action',
      'timeout',
      'recovery',
    ]);
    expect(t.branches[0]?.locktime.kind).toBe('immediate');
    expect(t.branches[1]?.locktime.kind).toBe('relative_blocks');
    expect(t.branches[2]?.locktime.kind).toBe('absolute_height');
  });
});

describe('settle-claim, fold-surrender, reveal-proof, timeout-branch, recovery', () => {
  it('settle-claim is HASH256 + EQUALVERIFY + CHECKSIG; no in-script timelock', () => {
    const s = buildSettleClaimScript({
      settlement_commitment: HASH_1,
      winner_pubkey: PUB_A,
    });
    expect(s[0]).toBe(OP.OP_HASH256);
    expect(s[s.length - 1]).toBe(OP.OP_CHECKSIG);
    expect(listOpcodes(s)).toContain(OP.OP_EQUALVERIFY);
    assertNoForbiddenOpcodes(s);
  });

  it('fold-surrender is a bare CHECKSIG (no reveal, no in-script timelock)', () => {
    const s = buildFoldSurrenderScript({
      original_funder_pubkey: PUB_A,
      recovery_height: HEIGHT,
    });
    const ops = listOpcodes(s);
    // Only a pubkey push + CHECKSIG.
    expect(ops).toContain(OP.OP_CHECKSIG);
    expect(ops).not.toContain(OP.OP_HASH256);
    assertNoForbiddenOpcodes(s);
  });

  it('fold-surrender build returns a single recovery_refund branch', () => {
    const t = buildFoldSurrender({
      original_funder_pubkey: PUB_A,
      recovery_height: HEIGHT,
    });
    expect(t.branches.map((b) => b.name)).toEqual(['recovery_refund']);
    expect(t.branches[0]?.locktime.kind).toBe('absolute_height');
  });

  it('reveal-proof verifies HASH256 binding + signer; no in-script timelock', () => {
    const s = buildRevealProofScript({
      card_commitment: HASH_1,
      signer_pubkey: PUB_A,
    });
    expect(s[0]).toBe(OP.OP_HASH256);
    expect(listOpcodes(s)).toContain(OP.OP_EQUALVERIFY);
    expect(s[s.length - 1]).toBe(OP.OP_CHECKSIG);
    assertNoForbiddenOpcodes(s);
  });

  it('timeout-branch is preimage + multisig; no in-script timelock', () => {
    const s = buildTimeoutBranchScript({
      decision_timeout_blocks: 6,
      timeout_template_hash: HASH_1,
      authoriser_pubkeys: [PUB_A, PUB_B],
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_HASH256);
    expect(ops).toContain(OP.OP_CHECKMULTISIG);
    assertNoForbiddenOpcodes(s);
  });

  it('timeout-branch build returns relative_blocks locktime', () => {
    const t = buildTimeoutBranch({
      decision_timeout_blocks: 6,
      timeout_template_hash: HASH_1,
      authoriser_pubkeys: [PUB_A, PUB_B],
    });
    expect(t.locktime.kind).toBe('relative_blocks');
  });

  it('recovery-branch is pubkey + CHECKSIG; no in-script timelock', () => {
    const s = buildRecoveryBranch({
      recovery_height: HEIGHT,
      signer_pubkey: PUB_A,
    });
    const ops = listOpcodes(s);
    expect(ops).toContain(OP.OP_CHECKSIG);
    assertNoForbiddenOpcodes(s);
    expect(s[s.length - 1]).toBe(OP.OP_CHECKSIG);
  });

  it('recovery-branch build returns absolute_height locktime', () => {
    const t = buildRecoveryBranchTemplate({
      recovery_height: HEIGHT,
      signer_pubkey: PUB_A,
    });
    expect(t.locktime.kind).toBe('absolute_height');
  });
});

describe('regression guard: NO template emits opcode 0xb1 or 0xb2 (inert no-ops on BSV post-Genesis)', () => {
  // Opcode bytes 0xb1 and 0xb2 are inert no-ops on BSV post-Genesis and
  // must never appear in any cardtable script. This test re-runs every
  // template once and asserts the absence of both 0xb1 and 0xb2 from
  // their opcode streams.
  it('every template is clean', () => {
    const scripts: Uint8Array[] = [
      buildTableRootLockingScript({
        seated_pubkeys: [PUB_A, PUB_B],
        recovery_height: HEIGHT,
      }),
      buildStakeLockScript({
        player_pubkey: PUB_A,
        operator_pubkey: PUB_B,
        expected_settlement_hash: HASH_1,
        recovery_height: HEIGHT,
      }),
      buildPotLockScript({
        seated_pubkeys: [PUB_A, PUB_B],
        winner_proof_hash: HASH_2,
        winner_pubkey: PUB_A,
        refund_pubkey: PUB_B,
        recovery_height: HEIGHT,
      }),
      buildEntropyCommitScript({
        commitment_hash: HASH_1,
        player_pubkey: PUB_A,
        other_pubkeys: [PUB_B],
        decision_timeout_blocks: 6,
        recovery_height: HEIGHT,
      }),
      buildCardCustodyScript({
        face_commitment: HASH_1,
        holder_pubkey: PUB_A,
        original_funder_pubkey: PUB_B,
        recovery_height: HEIGHT,
      }),
      buildRoundStateScript({
        successor_template_hash: HASH_1,
        timeout_template_hash: HASH_2,
        acting_player_pubkey: PUB_A,
        seated_pubkeys: [PUB_A, PUB_B],
        decision_timeout_blocks: 6,
        recovery_height: HEIGHT,
      }),
      buildSettleClaimScript({
        settlement_commitment: HASH_1,
        winner_pubkey: PUB_A,
      }),
      buildFoldSurrenderScript({
        original_funder_pubkey: PUB_A,
        recovery_height: HEIGHT,
      }),
      buildRevealProofScript({
        card_commitment: HASH_1,
        signer_pubkey: PUB_A,
      }),
      buildTimeoutBranchScript({
        decision_timeout_blocks: 6,
        timeout_template_hash: HASH_1,
        authoriser_pubkeys: [PUB_A, PUB_B],
      }),
      buildRecoveryBranch({
        recovery_height: HEIGHT,
        signer_pubkey: PUB_A,
      }),
    ];
    for (const s of scripts) {
      const ops = listOpcodes(s);
      expect(ops).not.toContain(0xb1);
      expect(ops).not.toContain(0xb2);
    }
  });
});
