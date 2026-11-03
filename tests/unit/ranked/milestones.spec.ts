// 2.0 M2 — rank milestones: band membership and the Path comparison
// (coach-intel.md §1.5). Band edges checked at every boundary listed in the
// card: 14/15, 17/18, 20/21, 24/25, 28/29.
import { describe, expect, it } from 'vitest';
import { bandFor, compareToPath } from '../../../src/domain/ranked/milestones';

describe('bandFor', () => {
  it('finds the right band at every edge', () => {
    expect(bandFor(14)?.id).toBe('foundations');
    expect(bandFor(15)?.id).toBe('dragons');
    expect(bandFor(17)?.id).toBe('dragons');
    expect(bandFor(18)?.id).toBe('rulers');
    expect(bandFor(20)?.id).toBe('rulers');
    expect(bandFor(21)?.id).toBe('storm');
    expect(bandFor(24)?.id).toBe('storm');
    expect(bandFor(25)?.id).toBe('tekken');
    expect(bandFor(28)?.id).toBe('tekken');
    expect(bandFor(29)?.id).toBe('destruction');
  });

  it('carries the Path stage range from the rank pack', () => {
    expect(bandFor(0)?.stages).toEqual([0, 3]);
    expect(bandFor(15)?.stages).toEqual([4, 5]);
    expect(bandFor(18)?.stages).toEqual([5, 6]);
    expect(bandFor(21)?.stages).toEqual([7, 7]);
    expect(bandFor(25)?.stages).toEqual([8, 8]);
    expect(bandFor(29)?.stages).toEqual([9, 9]);
  });

  it('returns undefined for an unknown rank', () => {
    expect(bandFor(null)).toBeUndefined();
    expect(bandFor(undefined)).toBeUndefined();
  });
});

describe('compareToPath', () => {
  it('is behind when the Path stage is below the band range', () => {
    expect(compareToPath(15, 2)).toBe('behind'); // Garyu (stages 4-5), Path stage 2
  });

  it('is on-track when the Path stage sits inside the band range', () => {
    expect(compareToPath(15, 4)).toBe('on-track');
    expect(compareToPath(15, 5)).toBe('on-track');
  });

  it('is ahead when the Path stage is past the band range', () => {
    expect(compareToPath(0, 8)).toBe('ahead'); // Beginner (stages 0-3), Path stage 8
  });

  it('is null when the rank or the stage is unknown', () => {
    expect(compareToPath(null, 4)).toBeNull();
    expect(compareToPath(15, null)).toBeNull();
    expect(compareToPath(undefined, undefined)).toBeNull();
  });
});
