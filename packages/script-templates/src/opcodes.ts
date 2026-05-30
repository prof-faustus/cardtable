/**
 * BSV Script opcode constants.
 *
 * Only the opcodes the cardtable templates require, all operational on
 * BSV post-Genesis. Timing constraints in this protocol live at the
 * **transaction level** (`nLockTime`, `nSequence`); no in-script
 * timelock opcode is used by any template.
 */

export const OP = {
  OP_0: 0x00,
  OP_FALSE: 0x00,
  OP_1NEGATE: 0x4f,
  OP_RESERVED: 0x50,
  OP_1: 0x51,
  OP_TRUE: 0x51,
  OP_2: 0x52,
  OP_3: 0x53,
  OP_4: 0x54,
  OP_5: 0x55,
  OP_6: 0x56,
  OP_7: 0x57,
  OP_8: 0x58,
  OP_9: 0x59,
  OP_10: 0x5a,
  OP_11: 0x5b,
  OP_12: 0x5c,
  OP_13: 0x5d,
  OP_14: 0x5e,
  OP_15: 0x5f,
  OP_16: 0x60,
  OP_NOP: 0x61,
  OP_VER: 0x62,
  OP_IF: 0x63,
  OP_NOTIF: 0x64,
  OP_ELSE: 0x67,
  OP_ENDIF: 0x68,
  OP_VERIFY: 0x69,
  OP_RETURN: 0x6a,
  OP_TOALTSTACK: 0x6b,
  OP_FROMALTSTACK: 0x6c,
  OP_DROP: 0x75,
  OP_DUP: 0x76,
  OP_NIP: 0x77,
  OP_OVER: 0x78,
  OP_EQUAL: 0x87,
  OP_EQUALVERIFY: 0x88,
  OP_ADD: 0x93,
  OP_SUB: 0x94,
  OP_RIPEMD160: 0xa6,
  OP_SHA1: 0xa7,
  OP_SHA256: 0xa8,
  OP_HASH160: 0xa9,
  OP_HASH256: 0xaa,
  OP_CODESEPARATOR: 0xab,
  OP_CHECKSIG: 0xac,
  OP_CHECKSIGVERIFY: 0xad,
  OP_CHECKMULTISIG: 0xae,
  OP_CHECKMULTISIGVERIFY: 0xaf,
} as const;

export type Opcode = (typeof OP)[keyof typeof OP];

/** Encode a small integer as its OP_n form. Throws for n outside [0,16]. */
export function opNumber(n: number): number {
  if (n === 0) return OP.OP_0;
  if (!Number.isInteger(n) || n < 1 || n > 16) {
    throw new Error(`opNumber: only 0..16 representable as OP_N (got ${n})`);
  }
  return OP.OP_1 + (n - 1);
}
