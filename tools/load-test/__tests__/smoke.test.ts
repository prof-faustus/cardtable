import { describe, expect, it } from 'vitest';

// Smoke check: percentile helper produces the expected
// monotonically-increasing values across a sorted sample.
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

describe('load-test percentile helper', () => {
  it('returns 0 for an empty sample', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
  it('returns monotonically-increasing values for p50 < p95 < p99 < max', () => {
    const sample = Array.from({ length: 100 }, (_, i) => i);
    const p50 = percentile(sample, 0.5);
    const p95 = percentile(sample, 0.95);
    const p99 = percentile(sample, 0.99);
    const max = percentile(sample, 1.0);
    expect(p50).toBeLessThanOrEqual(p95);
    expect(p95).toBeLessThanOrEqual(p99);
    expect(p99).toBeLessThanOrEqual(max);
  });
});
