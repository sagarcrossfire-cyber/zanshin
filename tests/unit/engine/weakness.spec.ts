// Spec §7.4 — weakness detection: formulas, minimum samples, targets per act,
// severity, top-2, trend.
import { detectWeaknesses, type WeaknessMatchSet, type WeaknessTallies } from '../../../src/domain/engine/weakness';

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

describe('detectWeaknesses — formulas and samples', () => {
  it('computes missed punishes per game over the last 10 games', () => {
    const result = detectWeaknesses([set(10, { missedPunishes: 30 })], 'shu');
    expect(result[0]).toMatchObject({ metric: 'missedPunishesPerGame', value: 3, target: 2, severity: 0.5, sample: 10, games: 10 });
  });

  it('uses only the last 10 games, scaling a straddling set', () => {
    const result = detectWeaknesses([
      set(10, { missedPunishes: 0 }),
      set(10, { missedPunishes: 40 }),
    ], 'shu');
    // Newest set (40 misses over 10 games) is the whole window.
    expect(result[0]?.value).toBe(4);
  });

  it('excludes metrics below their minimum sample', () => {
    // 4 games < 5-game minimum for missed punishes (and for per-game oki).
    expect(detectWeaknesses([set(4, { missedPunishes: 20 })], 'shu')).toEqual([]);
    // 4 throws < 5-throw minimum; oki neutralised at target.
    expect(detectWeaknesses([set(10, { throwsBroken: 1, throwsMissed: 3, okiConverted: 10 })], 'shu')).toEqual([]);
    // 2 Heats < 3-Heat minimum (Ha); oki neutralised at target.
    expect(detectWeaknesses([set(10, { heatConverted: 1, heatWasted: 1, okiConverted: 10 })], 'ha')).toEqual([]);
  });

  it('computes panic-tool success from all Flash and Spin attempts', () => {
    const result = detectWeaknesses([
      set(10, {
        flashHit: 2, flashBlocked: 3, flashWhiffed: 1, spinEscaped: 1, spinPunished: 1,
        missedPunishes: 10, okiConverted: 10,
      }),
    ], 'ha');
    // Success (2+1)/8 = 0.375 vs target 0.55 -> severity (0.55-0.375)/0.55 = 0.318.
    const panic = result.find((w) => w.metric === 'panicSuccess');
    expect(panic).toMatchObject({ metric: 'panicSuccess', value: 0.375, target: 0.55, sample: 8 });
    expect(panic?.severity).toBeCloseTo(0.3182);
  });

  it('computes throw breaks, lows blocked, heat wasted and oki per game', () => {
    const throws = detectWeaknesses([set(10, { throwsBroken: 2, throwsMissed: 8, okiConverted: 10 })], 'ha');
    expect(throws.find((w) => w.metric === 'throwBreaks')?.value).toBe(0.2);
    const lows = detectWeaknesses([set(10, { lowsBlocked: 2, lowsEaten: 8, okiConverted: 10 })], 'ha');
    expect(lows.find((w) => w.metric === 'lowsBlocked')?.value).toBe(0.2);
    const heat = detectWeaknesses([set(10, { heatConverted: 2, heatWasted: 8, okiConverted: 10 })], 'ha');
    expect(heat.find((w) => w.metric === 'heatWasted')?.value).toBe(0.8);
    const oki = detectWeaknesses([set(10, { okiConverted: 2 })], 'ha');
    expect(oki.find((w) => w.metric === 'okiPerGame')?.value).toBe(0.2);
  });

  it('returns at most the top two by severity', () => {
    const result = detectWeaknesses([
      set(10, {
        missedPunishes: 40, hitWhileMinus: 40,
        throwsBroken: 0, throwsMissed: 10,
        lowsBlocked: 0, lowsEaten: 10,
      }),
    ], 'shu');
    expect(result).toHaveLength(2);
    expect(result[0]?.severity).toBeGreaterThanOrEqual(result[1]?.severity ?? 0);
  });

  it('excludes metrics already meeting their target', () => {
    expect(detectWeaknesses([set(10, { missedPunishes: 10 })], 'shu')).toEqual([]);
  });
});

describe('detectWeaknesses — targets per act', () => {
  it('has no panic, heat or oki target in Shu', () => {
    const result = detectWeaknesses([
      set(10, {
        flashHit: 0, flashBlocked: 10, heatWasted: 10, okiConverted: 0,
      }),
    ], 'shu');
    expect(result.map((w) => w.metric)).not.toContain('panicSuccess');
    expect(result.map((w) => w.metric)).not.toContain('heatWasted');
    expect(result.map((w) => w.metric)).not.toContain('okiPerGame');
  });

  it('uses Ha targets (missed <=1.0, panic >=55%, oki >=0.5)', () => {
    const result = detectWeaknesses([set(10, { missedPunishes: 15, okiConverted: 2 })], 'ha');
    const missed = result.find((w) => w.metric === 'missedPunishesPerGame');
    expect(missed?.target).toBe(1);
    expect(missed?.severity).toBeCloseTo(0.5);
    const oki = result.find((w) => w.metric === 'okiPerGame');
    expect(oki?.target).toBe(0.5);
  });

  it('uses Ri targets (missed <=0.5, throw breaks >=60%, lows >=70%)', () => {
    const missed = detectWeaknesses([set(10, { missedPunishes: 10, okiConverted: 10 })], 'ri');
    expect(missed.find((w) => w.metric === 'missedPunishesPerGame')?.target).toBe(0.5);
    const throws = detectWeaknesses([set(10, { missedPunishes: 5, throwsBroken: 5, throwsMissed: 5, okiConverted: 10 })], 'ri');
    expect(throws.find((w) => w.metric === 'throwBreaks')?.target).toBe(0.6);
    const lows = detectWeaknesses([set(10, { missedPunishes: 5, lowsBlocked: 6, lowsEaten: 4, okiConverted: 10 })], 'ri');
    expect(lows.find((w) => w.metric === 'lowsBlocked')?.target).toBe(0.7);
  });

  it('accepts target overrides', () => {
    const result = detectWeaknesses(
      [set(10, { missedPunishes: 15 })],
      'shu',
      { missedPunishesPerGame: 1.0 },
    );
    expect(result[0]?.target).toBe(1);
    expect(result[0]?.severity).toBeCloseTo(0.5);
    const removed = detectWeaknesses(
      [set(10, { missedPunishes: 30 })],
      'shu',
      { missedPunishesPerGame: null },
    );
    expect(removed.map((w) => w.metric)).not.toContain('missedPunishesPerGame');
  });

  it('carries the feeding stage indexes from the table', () => {
    const result = detectWeaknesses([set(10, { missedPunishes: 30 })], 'shu');
    expect(result[0]?.feedsStages).toEqual([1, 3]);
  });
});

describe('detectWeaknesses — trend', () => {
  it('is null below 20 games', () => {
    const result = detectWeaknesses([set(10, { missedPunishes: 30 })], 'shu');
    expect(result[0]?.trend).toBeNull();
    expect(result[0]?.previousValue).toBeNull();
  });

  it('compares the last 10 games with the 10 before them', () => {
    // Oldest first: previous window 4.0/game, current window 3.0/game -> better.
    const result = detectWeaknesses([
      set(10, { missedPunishes: 40 }),
      set(10, { missedPunishes: 30 }),
    ], 'shu');
    expect(result[0]?.trend).toBe('better');
    expect(result[0]?.previousValue).toBeCloseTo(4);
    // Worsening direction.
    const worse = detectWeaknesses([
      set(10, { missedPunishes: 20 }),
      set(10, { missedPunishes: 30 }),
    ], 'shu');
    expect(worse[0]?.trend).toBe('worse');
    // Same value -> same.
    const same = detectWeaknesses([
      set(10, { missedPunishes: 30 }),
      set(10, { missedPunishes: 30 }),
    ], 'shu');
    expect(same[0]?.trend).toBe('same');
  });

  it('orders by `at`/`day` stamps when present, newest first', () => {
    const result = detectWeaknesses([
      set(10, { missedPunishes: 40 }, '2026-10-20'),
      set(10, { missedPunishes: 30 }, '2026-10-29'),
    ], 'shu');
    // Current window is the Oct 29 set (3.0), previous is Oct 20 (4.0) -> better.
    expect(result[0]?.value).toBe(3);
    expect(result[0]?.trend).toBe('better');
  });
});
