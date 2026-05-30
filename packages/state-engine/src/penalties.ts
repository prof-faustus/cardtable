/**
 * In-Between settlement and penalty logic.
 *
 * Pure functions over (visible cards, bet, rules). Three classes:
 *   - WIN: third card strictly between visible cards (open interval).
 *   - LOSS: third card outside the open interval.
 *   - CONSECUTIVE_PENALTY: visible cards are consecutive (rank difference == 1).
 *   - EQUAL_PENALTY: visible cards have equal rank.
 *
 * The `_PENALTY` outcomes resolve **before** examining the third card:
 * if the visible cards are consecutive or equal, the active player pays a
 * fixed penalty into the pot regardless of the third card.
 */

import type { RevealedCard, Satoshis, SettlementRules } from '@cardtable/protocol-types';
import { asSatoshis } from '@cardtable/protocol-types';
import type { SettlementOutcome } from '@cardtable/protocol-types';

/** Compute the settlement outcome class for an In-Between round. */
export function classifyInBetweenRound(
  visibleCards: readonly RevealedCard[],
): { outcome: SettlementOutcome; thirdCardChecked: boolean } {
  if (visibleCards.length !== 3) {
    throw new Error(
      `classifyInBetweenRound: expected exactly 3 visible cards, got ${visibleCards.length}`,
    );
  }
  const a = visibleCards[0];
  const b = visibleCards[1];
  const c = visibleCards[2];
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error('classifyInBetweenRound: indexing failure');
  }
  const aOrd = a.ordinal % 13;
  const bOrd = b.ordinal % 13;
  if (aOrd === bOrd) {
    return { outcome: 'equal_penalty', thirdCardChecked: false };
  }
  if (Math.abs(aOrd - bOrd) === 1) {
    return { outcome: 'consecutive_penalty', thirdCardChecked: false };
  }
  const cOrd = c.ordinal % 13;
  const low = Math.min(aOrd, bOrd);
  const high = Math.max(aOrd, bOrd);
  if (cOrd > low && cOrd < high) {
    return { outcome: 'win', thirdCardChecked: true };
  }
  return { outcome: 'loss', thirdCardChecked: true };
}

/**
 * Compute the value transfer between the active player and the pot for a
 * given outcome class, bet amount, and rule set.
 *
 * Returns `{ playerDelta, potDelta }` where the player's balance changes
 * by `playerDelta` and the pot changes by `potDelta`. By conservation
 * `playerDelta + potDelta == 0` always.
 */
export function computeValueTransfer(
  outcome: SettlementOutcome,
  bet: Satoshis,
  rules: SettlementRules,
): { playerDelta: number; potDelta: number } {
  switch (outcome) {
    case 'win': {
      // Player wins their bet × win_multiplier from the pot.
      const win = bet * rules.in_between_win_multiplier;
      return { playerDelta: win, potDelta: -win };
    }
    case 'loss': {
      const loss = bet * rules.in_between_loss_multiplier;
      return { playerDelta: -loss, potDelta: loss };
    }
    case 'pass': {
      return { playerDelta: 0, potDelta: 0 };
    }
    case 'consecutive_penalty': {
      const p = rules.consecutive_cards_penalty;
      return { playerDelta: -p, potDelta: p };
    }
    case 'equal_penalty': {
      const p = rules.equal_cards_penalty;
      return { playerDelta: -p, potDelta: p };
    }
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`computeValueTransfer: non-exhaustive outcome ${String(_exhaustive)}`);
    }
  }
}

/** Helper: clamp to Satoshis with a sanity check that the value is non-negative. */
export function clampSat(n: number): Satoshis {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`clampSat: result is not a non-negative safe integer: ${n}`);
  }
  return asSatoshis(n);
}
