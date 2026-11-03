import { describe, expect, it } from 'vitest';
import { dayHash, pickMoveOfTheDay } from '../../../src/domain/media/moveOfTheDay';

const has = (ids: string[]) => (id: string) => ids.includes(id);

describe('pickMoveOfTheDay (2.0 M6)', () => {
  it("prefers the first of today's plan moves that has a clip, in plan order", () => {
    expect(pickMoveOfTheDay(['Y-a', 'Y-b', 'Y-c'], ['Y-z'], '2026-11-03', has(['Y-b', 'Y-c', 'Y-z']))).toBe('Y-b');
  });

  it('falls back to a daily rotation through moves with clips, stable within a day', () => {
    const pool = ['Y-1', 'Y-2', 'Y-3', 'Y-4', 'Y-5'];
    const a = pickMoveOfTheDay([], pool, '2026-11-03', has(pool));
    expect(pool).toContain(a);
    expect(pickMoveOfTheDay([], pool, '2026-11-03', has(pool))).toBe(a);
    const week = new Set(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']
      .map((d) => pickMoveOfTheDay([], pool, d, has(pool))));
    expect(week.size).toBeGreaterThan(1);
  });

  it('only ever picks a move that has a clip, and null when none do', () => {
    expect(pickMoveOfTheDay(['Y-a'], ['Y-b', 'Y-c'], '2026-11-03', has(['Y-c']))).toBe('Y-c');
    expect(pickMoveOfTheDay(['Y-a'], ['Y-b'], '2026-11-03', has([]))).toBeNull();
  });

  it('dayHash is deterministic and unsigned', () => {
    expect(dayHash('2026-11-03')).toBe(dayHash('2026-11-03'));
    expect(dayHash('2026-11-03')).toBeGreaterThanOrEqual(0);
  });
});
