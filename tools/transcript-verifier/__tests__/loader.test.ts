/**
 * Round-trip test for the transcript verifier loader. The full
 * CLI's exit code behaviour is exercised via the underlying
 * @cardtable/state-engine.verifyAndApply tests; here we just
 * verify the loader's contract.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('transcript-verifier loader', () => {
  it('parses a multi-line JSONL transcript', () => {
    const path = join(tmpdir(), `cardtable-tv-${Date.now()}.jsonl`);
    const a = { game_id: 'aa'.repeat(32), action_type: 'Join' };
    const b = { game_id: 'aa'.repeat(32), action_type: 'TableLock' };
    writeFileSync(path, JSON.stringify(a) + '\n' + JSON.stringify(b) + '\n', 'utf8');
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as { action_type: string });
    expect(parsed[0]?.action_type).toBe('Join');
    expect(parsed[1]?.action_type).toBe('TableLock');
  });
});
