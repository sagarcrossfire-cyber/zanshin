// 2.0 M2 — isTallied / talliedOnly: imported sets without tallies
// (`tallied: false`) are dropped from per-game KPI consumers but kept for
// record/win-rate counts (callers decide which list to use).
import { describe, expect, it } from 'vitest';
import { isTallied, talliedOnly, type MaybeTallied } from '../../../src/domain/engine/tallied';

function set(overrides: Partial<MaybeTallied> = {}): MaybeTallied {
  return { ...overrides };
}

describe('isTallied', () => {
  it('is true when tallied is absent (tallies were entered)', () => {
    expect(isTallied(set())).toBe(true);
  });

  it('is true when tallied is explicitly true', () => {
    expect(isTallied(set({ tallied: true }))).toBe(true);
  });

  it('is false only when tallied is explicitly false', () => {
    expect(isTallied(set({ tallied: false }))).toBe(false);
  });
});

describe('talliedOnly', () => {
  it('filters out false-tallied sets, keeping order', () => {
    const a = set({ tallied: true });
    const b = set({ tallied: false });
    const c = set();
    expect(talliedOnly([a, b, c])).toEqual([a, c]);
  });

  it('returns [] for an empty input and keeps everything when none are false', () => {
    expect(talliedOnly([])).toEqual([]);
    const sets = [set(), set({ tallied: true })];
    expect(talliedOnly(sets)).toEqual(sets);
  });
});
