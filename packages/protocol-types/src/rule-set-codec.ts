/**
 * Canonical encoding of {@link RuleSet} per `spec/serialisation.md`
 * and {@link TYPE_TAG.RULE_SET}. Both `encodeRuleSet` (binary) and
 * `ruleSetHash` (domain-separated SHA-256) live here so the only
 * place that knows the RuleSet's field order is this one file.
 */

import { domainSha256, TYPE_TAG } from './hash.js';
import { CanonicalReader, CanonicalWriter } from './serialisation.js';
import type { Result, RuleSetHash } from './primitives.js';
import { asRuleSetHash, err, ok, protocolError } from './primitives.js';
import type {
  GameType,
  PenaltySchedule,
  RecoveryRules,
  RuleSet,
  SettlementRules,
} from './rule-set.js';

/** Game-type discriminant byte encoding. */
const GAME_TYPE_CODES: Readonly<Record<GameType, number>> = {
  in_between: 0x01,
} as const;

const GAME_TYPE_FROM_CODE: ReadonlyMap<number, GameType> = new Map([
  [0x01, 'in_between'],
]);

function encodePenalty(w: CanonicalWriter, p: PenaltySchedule): void {
  w.writeU64LE(p.non_reveal);
  w.writeU64LE(p.bad_reveal);
  w.writeU64LE(p.consecutive_cards);
  w.writeU64LE(p.equal_cards);
}

function decodePenalty(r: CanonicalReader): PenaltySchedule {
  return {
    non_reveal: r.readU64LE() as PenaltySchedule['non_reveal'],
    bad_reveal: r.readU64LE() as PenaltySchedule['bad_reveal'],
    consecutive_cards: r.readU64LE() as PenaltySchedule['consecutive_cards'],
    equal_cards: r.readU64LE() as PenaltySchedule['equal_cards'],
  };
}

function encodeSettlement(w: CanonicalWriter, s: SettlementRules): void {
  // Multipliers are integers in the v1 schema (no fractional multipliers).
  w.writeI32LE(s.in_between_win_multiplier);
  w.writeI32LE(s.in_between_loss_multiplier);
  w.writeU64LE(s.consecutive_cards_penalty);
  w.writeU64LE(s.equal_cards_penalty);
}

function decodeSettlement(r: CanonicalReader): SettlementRules {
  // readU32LE result is unsigned; v1 multipliers are positive — encode as i32 but always >= 0.
  const win = r.readU32LE();
  const loss = r.readU32LE();
  return {
    in_between_win_multiplier: win,
    in_between_loss_multiplier: loss,
    consecutive_cards_penalty: r.readU64LE() as SettlementRules['consecutive_cards_penalty'],
    equal_cards_penalty: r.readU64LE() as SettlementRules['equal_cards_penalty'],
  };
}

function encodeRecovery(w: CanonicalWriter, r: RecoveryRules): void {
  w.writeBool(r.refund_stakes_to_funders);
  w.writeBool(r.apply_non_reveal_penalty);
  w.writeBool(r.apply_bad_reveal_penalty);
}

function decodeRecovery(r: CanonicalReader): RecoveryRules {
  return {
    refund_stakes_to_funders: r.readBool(),
    apply_non_reveal_penalty: r.readBool(),
    apply_bad_reveal_penalty: r.readBool(),
  };
}

function encodeDefaults(w: CanonicalWriter, defaults: Readonly<Record<string, string>>): void {
  // Canonical: sorted by UTF-8 byte-order key.
  const keys = Object.keys(defaults).sort();
  w.writeVarint(keys.length);
  for (const k of keys) {
    w.writeUtf8(k);
    const v = defaults[k];
    if (v === undefined) throw new Error('encodeDefaults: undefined value for key ' + k);
    w.writeUtf8(v);
  }
}

function decodeDefaults(r: CanonicalReader): Readonly<Record<string, string>> {
  const n = r.readVarint();
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const k = r.readUtf8();
    const v = r.readUtf8();
    out[k] = v;
  }
  return out;
}

/**
 * Canonical binary encoding of a {@link RuleSet}.
 *
 * Layout:
 *   version_byte : u8 (= 1 for v1)
 *   game_type    : u8 (code from GAME_TYPE_CODES)
 *   player_count_min, player_count_max : u8 each
 *   stake_amount, min_bet, max_bet     : u64 LE each
 *   decision_timeout_blocks, recovery_timeout_blocks, invitation_window_blocks : u32 LE each
 *   default_action_by_state : sorted map (varint count, then [utf8 key, utf8 value])
 *   penalty_schedule : 4 × u64 LE (non_reveal, bad_reveal, consecutive_cards, equal_cards)
 *   deck_format : u8 (52 or 54)
 *   shuffle_algorithm_version : u8
 *   settlement_rules : 2 × i32 LE, 2 × u64 LE
 *   recovery_rules : 3 × bool
 *
 * Note: this function does NOT include the leading type tag; use
 * {@link ruleSetHash} for the full hash with the tag prefix.
 */
export function encodeRuleSet(rs: RuleSet): Uint8Array {
  if (rs.serialisation_version !== 1) {
    throw new Error(`encodeRuleSet: only serialisation_version 1 is implemented`);
  }
  const w = new CanonicalWriter();
  w.writeU8(1); // composite-local version byte
  const gameTypeCode = GAME_TYPE_CODES[rs.game_type];
  w.writeU8(gameTypeCode);
  if (!Number.isInteger(rs.player_count_min) || rs.player_count_min < 0 || rs.player_count_min > 255) {
    throw new Error('player_count_min out of range');
  }
  if (!Number.isInteger(rs.player_count_max) || rs.player_count_max < 0 || rs.player_count_max > 255) {
    throw new Error('player_count_max out of range');
  }
  w.writeU8(rs.player_count_min);
  w.writeU8(rs.player_count_max);
  w.writeU64LE(rs.stake_amount);
  w.writeU64LE(rs.min_bet);
  w.writeU64LE(rs.max_bet);
  w.writeU32LE(rs.decision_timeout_blocks);
  w.writeU32LE(rs.recovery_timeout_blocks);
  w.writeU32LE(rs.invitation_window_blocks);
  encodeDefaults(w, rs.default_action_by_state);
  encodePenalty(w, rs.penalty_schedule);
  w.writeU8(rs.deck_format);
  if (!Number.isInteger(rs.shuffle_algorithm_version) || rs.shuffle_algorithm_version < 0 || rs.shuffle_algorithm_version > 255) {
    throw new Error('shuffle_algorithm_version out of u8 range');
  }
  w.writeU8(rs.shuffle_algorithm_version);
  encodeSettlement(w, rs.settlement_rules);
  encodeRecovery(w, rs.recovery_rules);
  return w.bytes();
}

/** Decode a {@link RuleSet} from canonical bytes. */
export function decodeRuleSet(bytes: Uint8Array): Result<RuleSet> {
  try {
    const r = new CanonicalReader(bytes);
    const version = r.readU8();
    if (version !== 1) {
      return err(protocolError('UNSUPPORTED_VERSION', `RuleSet version ${version}`));
    }
    const code = r.readU8();
    const game_type = GAME_TYPE_FROM_CODE.get(code);
    if (!game_type) {
      return err(protocolError('INVALID_RULE_SET', `unknown game_type code 0x${code.toString(16)}`));
    }
    const player_count_min = r.readU8();
    const player_count_max = r.readU8();
    const stake_amount = r.readU64LE();
    const min_bet = r.readU64LE();
    const max_bet = r.readU64LE();
    const decision_timeout_blocks = r.readU32LE();
    const recovery_timeout_blocks = r.readU32LE();
    const invitation_window_blocks = r.readU32LE();
    const default_action_by_state = decodeDefaults(r);
    const penalty_schedule = decodePenalty(r);
    const deck_format = r.readU8();
    if (deck_format !== 52 && deck_format !== 54) {
      return err(protocolError('INVALID_RULE_SET', `deck_format must be 52 or 54`));
    }
    const shuffle_algorithm_version = r.readU8();
    const settlement_rules = decodeSettlement(r);
    const recovery_rules = decodeRecovery(r);
    const out: RuleSet = {
      game_type,
      player_count_min,
      player_count_max,
      stake_amount: stake_amount as RuleSet['stake_amount'],
      min_bet: min_bet as RuleSet['min_bet'],
      max_bet: max_bet as RuleSet['max_bet'],
      decision_timeout_blocks,
      recovery_timeout_blocks,
      invitation_window_blocks,
      default_action_by_state,
      penalty_schedule,
      deck_format,
      shuffle_algorithm_version,
      settlement_rules,
      recovery_rules,
      serialisation_version: 1,
    };
    return ok(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(protocolError('SERIALISATION_ERROR', msg));
  }
}

/** Domain-separated SHA-256 of the canonical encoding of a {@link RuleSet}. */
export async function ruleSetHash(rs: RuleSet): Promise<RuleSetHash> {
  const payload = encodeRuleSet(rs);
  const h = await domainSha256(TYPE_TAG.RULE_SET, payload);
  return asRuleSetHash(h);
}
