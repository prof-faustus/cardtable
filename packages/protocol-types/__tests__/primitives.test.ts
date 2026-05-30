import { describe, it, expect } from 'vitest';
import {
  asGameId,
  asHash256,
  asPubkey33,
  asSeat,
  asRoundNumber,
  asSatoshis,
  asBlockHeight,
  asActionNonce,
  asTxId,
  ok,
  err,
  protocolError,
} from '../src/index.js';

describe('asHash256', () => {
  it('accepts 64 lowercase hex chars', () => {
    expect(asHash256('0'.repeat(64))).toBeDefined();
  });
  it('rejects uppercase hex', () => {
    expect(() => asHash256('A'.repeat(64))).toThrow();
  });
  it('rejects short input', () => {
    expect(() => asHash256('0'.repeat(63))).toThrow();
  });
});

describe('asPubkey33', () => {
  it('accepts compressed pubkey starting 02', () => {
    expect(asPubkey33('02' + '0'.repeat(64))).toBeDefined();
  });
  it('accepts compressed pubkey starting 03', () => {
    expect(asPubkey33('03' + '0'.repeat(64))).toBeDefined();
  });
  it('rejects uncompressed prefix', () => {
    expect(() => asPubkey33('04' + '0'.repeat(64))).toThrow();
  });
});

describe('asSeat', () => {
  it('accepts non-negative integer', () => {
    expect(asSeat(0)).toBe(0);
    expect(asSeat(7)).toBe(7);
  });
  it('rejects negative', () => {
    expect(() => asSeat(-1)).toThrow();
  });
  it('rejects fractional', () => {
    expect(() => asSeat(1.5)).toThrow();
  });
});

describe('asBlockHeight', () => {
  it('accepts heights below the nLockTime height/timestamp threshold', () => {
    expect(asBlockHeight(0)).toBe(0);
    expect(asBlockHeight(499_999_999)).toBe(499_999_999);
  });
  it('rejects 5e8 and above', () => {
    expect(() => asBlockHeight(500_000_000)).toThrow();
  });
});

describe('asSatoshis', () => {
  it('accepts non-negative integer', () => {
    expect(asSatoshis(1000)).toBe(1000);
  });
  it('rejects negative', () => {
    expect(() => asSatoshis(-1)).toThrow();
  });
});

describe('asGameId, asActionNonce, asTxId', () => {
  it('all accept 64-hex strings', () => {
    expect(asGameId('a'.repeat(64))).toBeDefined();
    expect(asActionNonce('b'.repeat(64))).toBeDefined();
    expect(asTxId('c'.repeat(64))).toBeDefined();
  });
});

describe('asRoundNumber', () => {
  it('accepts 0 and positive integers', () => {
    expect(asRoundNumber(0)).toBe(0);
    expect(asRoundNumber(42)).toBe(42);
  });
  it('rejects negative', () => {
    expect(() => asRoundNumber(-1)).toThrow();
  });
});

describe('Result and ProtocolError', () => {
  it('ok carries the value', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });
  it('err carries the error', () => {
    const e = protocolError('STALE_STATE', 'state hash mismatch');
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('STALE_STATE');
      expect(r.error.context).toBe('state hash mismatch');
    }
  });
});
