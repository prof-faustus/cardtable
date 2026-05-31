/**
 * Smoke test that every spec/test-vectors/*.json file loads as
 * structurally valid JSON. CI already runs `jq -e .` over each file
 * but that does not catch logical errors a code-level loader would
 * (e.g. fields whose values use the wrong type).
 *
 * This test is the bridge from "the file parses as JSON" to "the
 * loader can find the expected top-level keys".
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const vectorsDir = resolve(here, '../../../spec/test-vectors');

interface AnyVector {
  readonly vector_id?: string;
  readonly description?: string;
  readonly inputs?: unknown;
  readonly initial_state?: unknown;
  readonly subcases?: unknown;
}

describe('spec/test-vectors load smoke test', () => {
  const files = readdirSync(vectorsDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));

  it('there is at least one vector file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`loads ${f} as a JSON object with at least one identifying field`, () => {
      const raw = readFileSync(join(vectorsDir, f), 'utf8');
      const parsed = JSON.parse(raw) as AnyVector;
      // Each vector MUST identify itself in at least one of the
      // standard top-level fields.
      const hasId =
        typeof parsed.vector_id === 'string' ||
        typeof parsed.description === 'string' ||
        parsed.inputs !== undefined ||
        parsed.initial_state !== undefined ||
        parsed.subcases !== undefined;
      expect(hasId).toBe(true);
    });
  }
});
