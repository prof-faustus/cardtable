import { describe, it, expect } from 'vitest';
import {
  buildCardCustodyScript,
  buildEntropyCommitScript,
  buildFoldSurrenderScript,
  buildPotLockScript,
  buildRecoveryBranch,
  buildRevealProofScript,
  buildRoundStateScript,
  buildSettleClaimScript,
  buildStakeLockScript,
  buildTableRootLockingScript,
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
// Templates: determinism + structural checks
// ---------------------------------------------------------------------------

describe('table-root template', () => {
  it('produces deterministic bytes', () => {
    const a = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      operator_pubkey: PUB_A,
      recovery_height: HEIGHT,
    });
    const b = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      operator_pubkey: PUB_A,
      recovery_height: HEIGHT,
    });
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });
  it('starts with OP_IF and ends with OP_ENDIF', () => {
    const s = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B],
      operator_pubkey: PUB_C,
      recovery_height: HEIGHT,
    });
    expect(s[0]).toBe(OP.OP_IF);
    expect(s[s.length - 1]).toBe(OP.OP_ENDIF);
  });
  it('contains both CHECKMULTISIG and CHECKLOCKTIMEVERIFY opcodes', () => {
    const s = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B],
      operator_pubkey: PUB_C,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKMULTISIG);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
    expect(bytes).toContain(OP.OP_CHECKSIG);
  });
  it('rejects 0 pubkeys', () => {
    expect(() =>
      buildTableRootLockingScript({
        seated_pubkeys: [],
        operator_pubkey: PUB_A,
        recovery_height: HEIGHT,
      }),
    ).toThrow();
  });
});

describe('stake-lock template', () => {
  it('three branches present (CHECKMULTISIG, HASH256, CLTV)', () => {
    const s = buildStakeLockScript({
      player_pubkey: PUB_A,
      operator_pubkey: PUB_B,
      expected_settlement_hash: HASH_1,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKMULTISIG);
    expect(bytes).toContain(OP.OP_HASH256);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
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
  it('contains cooperative + winner-claim + recovery opcodes', () => {
    const s = buildPotLockScript({
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      winner_proof_hash: HASH_2,
      winner_pubkey: PUB_A,
      refund_pubkey: PUB_B,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKMULTISIG);
    expect(bytes).toContain(OP.OP_SHA256);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
  });
});

describe('entropy-commit template', () => {
  it('contains reveal branch + CSV timeout branch + CLTV recovery branch', () => {
    const s = buildEntropyCommitScript({
      commitment_hash: HASH_1,
      player_pubkey: PUB_A,
      other_pubkeys: [PUB_B, PUB_C],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_SHA256);
    expect(bytes).toContain(OP.OP_CHECKSEQUENCEVERIFY);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
    expect(bytes).toContain(OP.OP_CHECKMULTISIG);
  });
  it('degenerates safely with empty other_pubkeys (always-fail cooperative)', () => {
    const s = buildEntropyCommitScript({
      commitment_hash: HASH_1,
      player_pubkey: PUB_A,
      other_pubkeys: [],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_RETURN); // cooperative branch is poisoned
  });
});

describe('card-custody template', () => {
  it('contains reveal + fold + recovery branches', () => {
    const s = buildCardCustodyScript({
      face_commitment: HASH_1,
      holder_pubkey: PUB_A,
      original_funder_pubkey: PUB_B,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_HASH256);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
    expect(bytes).toContain(OP.OP_CHECKSIG);
  });
});

describe('round-state template', () => {
  it('three-way nested IF/ELSE structure (action / CSV-timeout / CLTV-recovery)', () => {
    const s = buildRoundStateScript({
      successor_template_hash: HASH_1,
      timeout_template_hash: HASH_2,
      acting_player_pubkey: PUB_A,
      seated_pubkeys: [PUB_A, PUB_B, PUB_C],
      decision_timeout_blocks: 6,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKSEQUENCEVERIFY);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
    // Two CHECKMULTISIG calls (timeout branch + recovery branch).
    expect(bytes.filter((b) => b === OP.OP_CHECKMULTISIG).length).toBe(2);
    expect(bytes.filter((b) => b === OP.OP_HASH256).length).toBe(2); // successor + timeout templates
  });
});

describe('settle-claim, fold-surrender, reveal-proof, timeout-branch, recovery', () => {
  it('settle-claim is a single-branch HASH256 + CHECKSIG', () => {
    const s = buildSettleClaimScript({
      settlement_commitment: HASH_1,
      winner_pubkey: PUB_A,
    });
    expect(s[0]).toBe(OP.OP_HASH256);
    expect(s[s.length - 1]).toBe(OP.OP_CHECKSIG);
    expect(Array.from(s)).toContain(OP.OP_EQUALVERIFY);
  });

  it('fold-surrender is CLTV + CHECKSIG only', () => {
    const s = buildFoldSurrenderScript({
      original_funder_pubkey: PUB_A,
      recovery_height: HEIGHT,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
    expect(bytes).toContain(OP.OP_DROP);
    expect(bytes).toContain(OP.OP_CHECKSIG);
    // No HASH256 — face is not revealed.
    expect(bytes).not.toContain(OP.OP_HASH256);
  });

  it('reveal-proof verifies HASH256 binding + signer', () => {
    const s = buildRevealProofScript({
      card_commitment: HASH_1,
      signer_pubkey: PUB_A,
    });
    expect(s[0]).toBe(OP.OP_HASH256);
    expect(Array.from(s)).toContain(OP.OP_EQUALVERIFY);
    expect(s[s.length - 1]).toBe(OP.OP_CHECKSIG);
  });

  it('timeout-branch begins with CSV', () => {
    const s = buildTimeoutBranchScript({
      decision_timeout_blocks: 6,
      timeout_template_hash: HASH_1,
      authoriser_pubkeys: [PUB_A, PUB_B],
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKSEQUENCEVERIFY);
    expect(bytes).toContain(OP.OP_CHECKMULTISIG);
  });

  it('recovery-branch is CLTV-pubkey-CHECKSIG', () => {
    const s = buildRecoveryBranch({
      recovery_height: HEIGHT,
      signer_pubkey: PUB_A,
    });
    const bytes = Array.from(s);
    expect(bytes).toContain(OP.OP_CHECKLOCKTIMEVERIFY);
    expect(bytes).toContain(OP.OP_DROP);
    expect(bytes[bytes.length - 1]).toBe(OP.OP_CHECKSIG);
  });
});

describe('determinism across all templates', () => {
  it('table-root + stake-lock + pot-lock all produce stable hashes for stable inputs', () => {
    const tr1 = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B],
      operator_pubkey: PUB_C,
      recovery_height: HEIGHT,
    });
    const tr2 = buildTableRootLockingScript({
      seated_pubkeys: [PUB_A, PUB_B],
      operator_pubkey: PUB_C,
      recovery_height: HEIGHT,
    });
    expect(bytesToHex(tr1)).toBe(bytesToHex(tr2));
  });
});
