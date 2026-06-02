#!/usr/bin/env node
/**
 * cardtable-deck-simulator — deterministic deck/reveal simulator CLI.
 *
 *   cardtable-deck-simulator \
 *     --entropies <hex>,<hex>[,...] \
 *     [--deck-size 52] \
 *     [--algo 1] \
 *     [--positions 0,1,2]      # default: every position
 *
 * Prints a JSON object with the combined entropy, deck commitment hash,
 * the shuffled deck, and per-position honest reveal proofs (each with its
 * verification verdict). Exit 0 on success, 2 on bad arguments.
 *
 * Same combined entropy in => byte-identical commitment + proofs out, so
 * the output is a stable fixture source for replay/adversarial tests.
 */

import { argv, exit, stdout } from 'node:process';
import { simulateDeck } from './simulate.js';

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const entropiesArg = args['entropies'];
  if (!entropiesArg) {
    process.stderr.write(
      'usage: cardtable-deck-simulator --entropies <hex>,<hex>[,...] [--deck-size 52] [--algo 1] [--positions 0,1,2]\n',
    );
    exit(2);
  }
  const entropiesHex = entropiesArg.split(',').map((s) => s.trim()).filter((s) => s !== '');
  const result = await simulateDeck({
    entropiesHex,
    ...(args['deck-size'] ? { deckSize: parseInt(args['deck-size'], 10) } : {}),
    ...(args['algo'] ? { shuffleAlgorithmVersion: parseInt(args['algo'], 10) } : {}),
    ...(args['positions']
      ? { positions: args['positions'].split(',').map((s) => parseInt(s.trim(), 10)) }
      : {}),
  });
  stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  exit(1);
});
