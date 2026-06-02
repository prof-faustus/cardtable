/**
 * Deterministic deck/reveal simulator.
 *
 * Pure functions over @cardtable/crypto-cards that mirror exactly what an
 * honest engine does once the per-player entropy is fixed:
 *
 *   combineEntropy(entropies) -> buildDeckCommitment(combined, size, algo)
 *
 * From the resulting commitment we can derive three reveal outcomes for
 * every position, which are the building blocks of the entropy/reveal
 * adversarial scenarios (PROJECT_SPEC §783 #3 withheld reveal, #5 reveal
 * timeout, and the A03 forged-reveal defence):
 *
 *   - honest   — the canonical proof; `verifyRevealProof` returns true.
 *   - forged   — same nonces, wrong ordinal; verification returns false.
 *   - withheld — no proof emitted at all (modelled as `null`).
 *
 * Determinism is the whole point: identical entropy in => byte-identical
 * deck commitment and proofs out, on every machine, in TS and Go alike.
 */

import {
  buildDeckCommitment,
  combineEntropy,
  commitCard,
  fromHex,
  toHex,
  verifyRevealProof,
} from '@cardtable/crypto-cards';
import type { DeckCommitment } from '@cardtable/crypto-cards';

/** One position's reveal, with the verification verdict already computed. */
export interface RevealOutcome {
  readonly position: number;
  readonly ordinal: number;
  readonly cardNonceHex: string;
  readonly deckNonceHex: string;
  readonly commitmentHex: string;
  /** Whether `verifyRevealProof` accepts this (ordinal, nonces) against the commitment. */
  readonly verifies: boolean;
  readonly kind: 'honest' | 'forged';
}

export interface DeckSimResult {
  readonly combinedEntropyHex: string;
  readonly deckCommitmentHashHex: string;
  readonly deckSize: number;
  readonly shuffleAlgorithmVersion: number;
  readonly shuffledDeck: readonly number[];
  readonly reveals: readonly RevealOutcome[];
}

const DEFAULT_DECK_SIZE = 52;
const DEFAULT_ALGO = 1;

/** Combine per-player entropy and build the deterministic deck commitment. */
export async function buildDeck(
  entropiesHex: readonly string[],
  deckSize = DEFAULT_DECK_SIZE,
  shuffleAlgorithmVersion = DEFAULT_ALGO,
): Promise<DeckCommitment> {
  if (entropiesHex.length === 0) {
    throw new Error('buildDeck: at least one entropy contribution is required');
  }
  const combined = await combineEntropy(entropiesHex.map((e) => fromHex(e)));
  return buildDeckCommitment(combined, deckSize, shuffleAlgorithmVersion);
}

/** The canonical, verifying reveal for a position. */
export async function honestReveal(dc: DeckCommitment, position: number): Promise<RevealOutcome> {
  const p = dc.perPosition[position];
  if (p === undefined) throw new Error(`honestReveal: position ${position} out of range`);
  const verifies = await verifyRevealProof(p.commitment, {
    position: p.position,
    ordinal: p.ordinal,
    cardNonce: p.cardNonce,
    deckNonce: p.deckNonce,
  });
  return {
    position: p.position,
    ordinal: p.ordinal,
    cardNonceHex: toHex(p.cardNonce),
    deckNonceHex: toHex(p.deckNonce),
    commitmentHex: toHex(p.commitment),
    verifies,
    kind: 'honest',
  };
}

/**
 * A forged reveal: keeps the position's real nonces but claims a
 * different ordinal. `verifyRevealProof` recomputes the commitment from
 * the claimed ordinal and rejects it — the A03 defence in miniature.
 */
export async function forgeReveal(
  dc: DeckCommitment,
  position: number,
  wrongOrdinal: number,
): Promise<RevealOutcome> {
  const p = dc.perPosition[position];
  if (p === undefined) throw new Error(`forgeReveal: position ${position} out of range`);
  if (wrongOrdinal === p.ordinal) {
    throw new Error(`forgeReveal: ${wrongOrdinal} is the honest ordinal; choose a different one`);
  }
  const verifies = await verifyRevealProof(p.commitment, {
    position: p.position,
    ordinal: wrongOrdinal,
    cardNonce: p.cardNonce,
    deckNonce: p.deckNonce,
  });
  const forgedCommitment = await commitCard(wrongOrdinal, p.cardNonce, p.deckNonce);
  return {
    position: p.position,
    ordinal: wrongOrdinal,
    cardNonceHex: toHex(p.cardNonce),
    deckNonceHex: toHex(p.deckNonce),
    commitmentHex: toHex(forgedCommitment),
    verifies,
    kind: 'forged',
  };
}

/**
 * Simulate honest reveals for the requested positions (default: all).
 * Every outcome verifies; this is the deterministic-deck happy path.
 */
export async function simulateDeck(opts: {
  readonly entropiesHex: readonly string[];
  readonly deckSize?: number;
  readonly shuffleAlgorithmVersion?: number;
  readonly positions?: readonly number[];
}): Promise<DeckSimResult> {
  const deckSize = opts.deckSize ?? DEFAULT_DECK_SIZE;
  const algo = opts.shuffleAlgorithmVersion ?? DEFAULT_ALGO;
  const dc = await buildDeck(opts.entropiesHex, deckSize, algo);
  const positions = opts.positions ?? dc.perPosition.map((p) => p.position);
  const reveals: RevealOutcome[] = [];
  for (const pos of positions) reveals.push(await honestReveal(dc, pos));
  return {
    combinedEntropyHex: toHex(dc.combinedEntropy),
    deckCommitmentHashHex: toHex(dc.deckCommitmentHash),
    deckSize,
    shuffleAlgorithmVersion: algo,
    shuffledDeck: dc.shuffledDeck,
    reveals,
  };
}
