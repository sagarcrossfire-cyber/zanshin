// Spec §7.8 and §5.13 — consistency stats, KPI rollups, finding sentences.
import { findingSentence, kpiRollups, weeklyConsistency } from '../../../src/domain/engine/stats';
import type { WeaknessMatchSet, WeaknessTallies } from '../../../src/domain/engine/weakness';

function tallies(overrides: Partial<WeaknessTallies> = {}): WeaknessTallies {
  return {
    missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
    hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0, heatConverted: 0,
    heatWasted: 0, okiConverted: 0, ...overrides,
  };
}

function set(games: number, overrides: Partial<WeaknessTallies> = {}, day?: string): WeaknessMatchSet {
  return { games, tallies: tallies(overrides), ...(day !== undefined ? { day } : {}) };
}

describe('weeklyConsistency', () => {
  it('tracks sessions and minutes against plan, with no streak language', () => {
    const result = weeklyConsistency(
      [{ minutes: 30 }, { minutes: 25 }, { minutes: 30 }, { minutes: 33 }],
      5, 150,
    );
    expect(result.sessionsDone).toBe(4);
    expect(result.minutes).toBe(118);
    expect(result.sessionsRatio).toBeCloseTo(0.8);
    expect(result.minutesRatio).toBeCloseTo(118 / 150);
    expect(Object.keys(result)).not.toContain('streak');
  });

  it('returns null ratios when the plan is zero', () => {
    const result = weeklyConsistency([{ minutes: 30 }], 0, 0);
    expect(result.sessionsRatio).toBeNull();
    expect(result.minutesRatio).toBeNull();
  });
});

describe('kpiRollups', () => {
  it('rolls 10-game windows in chronological order', () => {
    const windows = kpiRollups([
      set(10, { missedPunishes: 30, throwsBroken: 4, throwsMissed: 6, lowsBlocked: 6, lowsEaten: 4 }, '2026-10-20'),
      set(10, { missedPunishes: 10, throwsBroken: 8, throwsMissed: 2, lowsBlocked: 8, lowsEaten: 2 }, '2026-10-29'),
    ]);
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ games: 10, missedPunishesPerGame: 3, throwBreakRate: 0.4, lowsBlocked: 0.6 });
    expect(windows[1]).toMatchObject({ games: 10, missedPunishesPerGame: 1, throwBreakRate: 0.8, lowsBlocked: 0.8 });
    expect(windows[1]?.day).toBe('2026-10-29');
  });

  it('scales the oldest set when a window straddles 10 games', () => {
    const windows = kpiRollups([
      set(6, { missedPunishes: 12 }, '2026-10-20'),
      set(6, { missedPunishes: 6 }, '2026-10-29'),
    ]);
    // Second window: all 6 of the new set + 4/6 of the old set (8 misses) = 14/10 = 1.4.
    expect(windows[1]?.games).toBe(10);
    expect(windows[1]?.missedPunishesPerGame).toBeCloseTo(1.4);
  });

  it('returns null rates below the 5-attempt minimum sample', () => {
    const windows = kpiRollups([set(10, { throwsBroken: 1, throwsMissed: 1 })]);
    expect(windows[0]?.throwBreakRate).toBeNull();
    expect(windows[0]?.panicSuccess).toBeNull();
    expect(windows[0]?.lowsBlocked).toBeNull();
  });

  it('handles zero and one sets without errors', () => {
    expect(kpiRollups([])).toEqual([]);
    expect(kpiRollups([set(3, { missedPunishes: 3 })])[0]?.missedPunishesPerGame).toBe(1);
  });
});

describe('findingSentence', () => {
  it('states the shortfall below the minimum sample', () => {
    expect(findingSentence({
      metricLabel: 'Throw breaks', values: [0.38], target: 0.4, direction: 'higher',
      format: 'rate', sample: 4, minSample: 5,
    })).toBe('Not enough data for Throw breaks: 4 of 5 required.');
    expect(findingSentence({
      metricLabel: 'Mastery index', values: [], direction: 'higher', format: 'count',
    })).toBe('No data yet for Mastery index.');
  });

  it('describes improvement, decline and flat series with their numbers', () => {
    expect(findingSentence({
      metricLabel: 'Missed punishes per game', values: [2.6, 2.2, 1.9], target: 2.0,
      direction: 'lower', format: 'perGame', sample: 10,
    })).toBe(
      'Missed punishes per game improved from 2.6 to 1.9 (target 2.0) over 3 points (sample 10).',
    );
    expect(findingSentence({
      metricLabel: 'Throw breaks', values: [0.5, 0.38], target: 0.4,
      direction: 'higher', format: 'rate',
    })).toBe('Throw breaks declined from 50% to 38% (target 40%) over 2 points.');
    expect(findingSentence({
      metricLabel: 'Lows blocked', values: [0.6, 0.6], target: 0.6,
      direction: 'higher', format: 'rate',
    })).toBe('Lows blocked unchanged from 60% to 60% (target 60%) over 2 points.');
  });

  it('handles a single point without a trend word', () => {
    expect(findingSentence({
      metricLabel: 'Practice minutes', values: [118], target: 150,
      direction: 'higher', format: 'minutes',
    })).toBe('Practice minutes is 118 (target 150).');
  });

  it('works without a target', () => {
    expect(findingSentence({
      metricLabel: 'Games logged', values: [4, 7], direction: 'higher', format: 'count',
    })).toBe('Games logged improved from 4 to 7 over 2 points.');
  });
});
