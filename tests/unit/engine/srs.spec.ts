// Spec §7.6 — the SM-2 variant table, the 04:00 day boundary, due counts.
import { dueCount, gradeCard, practiceDay, type CardState } from '../../../src/domain/engine/srs';

function card(overrides: Partial<CardState> = {}): CardState {
  return {
    cardId: 'c1', reps: 0, lapses: 0, ease: 2.5, intervalDays: 0, due: '2026-10-29', history: [],
    ...overrides,
  };
}

const AT = '2026-10-30T20:00:00Z';

describe('gradeCard — the §7.6 table', () => {
  it.each([
    // [start, grade, expected reps, interval, ease, lapses]
    ['new card, Good', card(), 2, 1, 1, 2.5, 0],
    ['second review, Good', card({ reps: 1, intervalDays: 1 }), 2, 2, 3, 2.5, 0],
    ['third review, Good (7.5 rounds up)', card({ reps: 2, intervalDays: 3, ease: 2.5 }), 2, 3, 8, 2.5, 0],
    ['Easy on a new card', card(), 3, 1, 4, 2.65, 0],
    ['lapse, Again', card({ reps: 3, intervalDays: 8, ease: 2.5 }), 0, 0, 1, 2.3, 1],
    ['Hard', card({ reps: 3, intervalDays: 8, ease: 2.5 }), 1, 4, 10, 2.35, 0],
    ['ease floor, Again', card({ reps: 3, intervalDays: 8, ease: 1.35 }), 0, 0, 1, 1.3, 1],
    ['interval cap, Good', card({ reps: 5, intervalDays: 150, ease: 2.5 }), 2, 6, 180, 2.5, 0],
  ] as const)('%s', (_label, start, grade, reps, intervalDays, ease, lapses) => {
    const result = gradeCard(start, grade, AT);
    expect(result.reps).toBe(reps);
    expect(result.intervalDays).toBe(intervalDays);
    expect(result.ease).toBeCloseTo(ease);
    expect(result.lapses).toBe(lapses);
    expect(result.lastGrade).toBe(grade);
    expect(result.history).toHaveLength(start.history.length + 1);
  });

  it("schedules Easy from Good's interval times 1.3, at least 4", () => {
    // reps 2, interval 3: Good would give round(3 x 2.5) = 8 -> Easy gives round(8 x 1.3) = 10.
    const result = gradeCard(card({ reps: 2, intervalDays: 3, ease: 2.5 }), 3, AT);
    expect(result.intervalDays).toBe(10);
    expect(result.ease).toBeCloseTo(2.65);
    // reps 3, interval 8: Good gives 20 -> Easy gives 26.
    const later = gradeCard(card({ reps: 3, intervalDays: 8, ease: 2.5 }), 3, AT);
    expect(later.intervalDays).toBe(26);
    expect(later.ease).toBeCloseTo(2.65);
  });

  it('caps Hard intervals at 180 and floors Hard ease at 1.3', () => {
    const capped = gradeCard(card({ reps: 5, intervalDays: 170, ease: 2.5 }), 1, AT);
    expect(capped.intervalDays).toBe(180);
    const floored = gradeCard(card({ reps: 5, intervalDays: 10, ease: 1.35 }), 1, AT);
    expect(floored.ease).toBeCloseTo(1.3);
  });

  it('does not mutate the input state', () => {
    const start = card({ reps: 2, intervalDays: 3 });
    const snapshot = { ...start, history: [...start.history] };
    gradeCard(start, 2, AT);
    expect(start).toEqual(snapshot);
  });
});

describe('practiceDay and due dates', () => {
  it('counts 01:30 as the previous practice day (late-night case)', () => {
    expect(practiceDay('2026-10-30T01:30:00Z', '04:00')).toBe('2026-10-29');
    const result = gradeCard(card(), 2, '2026-10-30T01:30:00Z', '04:00');
    expect(result.due).toBe('2026-10-30');
  });

  it('rolls over exactly at the boundary', () => {
    expect(practiceDay('2026-10-30T04:00:00Z', '04:00')).toBe('2026-10-30');
    expect(practiceDay('2026-10-30T03:59:00Z', '04:00')).toBe('2026-10-29');
  });

  it('honours a custom boundary and defaults to 04:00', () => {
    expect(practiceDay('2026-10-30T04:30:00Z', '05:00')).toBe('2026-10-29');
    expect(practiceDay('2026-10-30T04:30:00Z')).toBe('2026-10-30');
  });

  it('sets due = practice day + interval', () => {
    const result = gradeCard(card({ reps: 2, intervalDays: 3 }), 2, AT);
    expect(result.due).toBe('2026-11-07');
  });
});

describe('dueCount', () => {
  it('counts cards due on or before the day', () => {
    const states = [
      card({ cardId: 'a', due: '2026-10-28' }),
      card({ cardId: 'b', due: '2026-10-30' }),
      card({ cardId: 'c', due: '2026-10-31' }),
    ];
    expect(dueCount(states, '2026-10-30')).toBe(2);
    expect(dueCount(states, '2026-10-27')).toBe(0);
    expect(dueCount([], '2026-10-30')).toBe(0);
  });
});
