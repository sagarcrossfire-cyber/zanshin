// §7.1/§7.9 — KPI assembly for mastery: node KPIs computed from match
// tallies over the last 10 games plus drill success; KPIs below their
// minimum sample are omitted; metrics with no source are omitted.
import { describe, expect, it } from 'vitest';
import { kpiInputsForNode } from '../../src/services/lab';
import type { DrillSet, MatchSet } from '../../src/data/schemas';

function tallies(overrides: Partial<MatchSet['tallies']> = {}): MatchSet['tallies'] {
  return {
    missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
    hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
    heatConverted: 0, heatWasted: 0, okiConverted: 0,
    ...overrides,
  };
}

function matchSet(at: string, games: number, wins: number, tallyOverrides: Partial<MatchSet['tallies']> = {}): MatchSet {
  return {
    id: `m-${at}`, at, day: at.slice(0, 10), mode: 'ranked',
    opponentCharacter: 'Kazuya', games, wins,
    tallies: tallies(tallyOverrides), beatBy: [], tags: [],
  };
}

function drillSet(at: string, successes: number, reps: number): DrillSet {
  return {
    id: `s-${at}`, sessionId: 'sess', drillId: 'd1-punish-ladder', nodeId: 'n1-punish',
    at, day: at.slice(0, 10), reps, successes,
  };
}

describe('kpiInputsForNode', () => {
  it('computes missed punishes per game over the last 10 games (G5 shape)', () => {
    const sets = [
      matchSet('2026-10-29T20:00:00.000Z', 5, 2, { missedPunishes: 15 }),
      matchSet('2026-10-30T20:00:00.000Z', 5, 3, { missedPunishes: 15 }),
    ];
    const inputs = kpiInputsForNode(
      [{ metric: 'missedPunishesPerGame', op: '<=', value: 2, window: { kind: 'games', n: 10 }, minSample: 5 }],
      [],
      sets,
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.value).toBeCloseTo(3.0);
    expect(inputs[0]?.direction).toBe('lower');
    expect(inputs[0]?.sample).toBe(10);
  });

  it('omits KPIs below their minimum sample', () => {
    const sets = [matchSet('2026-10-30T20:00:00.000Z', 3, 1, { missedPunishes: 9 })];
    const inputs = kpiInputsForNode(
      [{ metric: 'missedPunishesPerGame', op: '<=', value: 2, window: { kind: 'games', n: 10 }, minSample: 5 }],
      [],
      sets,
    );
    expect(inputs).toHaveLength(0);
  });

  it('computes drill success from the last N sets', () => {
    const sets = [
      drillSet('2026-10-28T20:00:00.000Z', 8, 10),
      drillSet('2026-10-29T20:00:00.000Z', 9, 10),
      drillSet('2026-10-30T20:00:00.000Z', 7, 10),
    ];
    const inputs = kpiInputsForNode(
      [{ metric: 'drillSuccess', op: '>=', value: 0.8, window: { kind: 'sets', n: 3 }, minSample: 3 }],
      sets,
      [],
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.value).toBeCloseTo(0.8);
    expect(inputs[0]?.direction).toBe('higher');
  });

  it('computes throw break rate and heat waste rate', () => {
    const sets = [matchSet('2026-10-30T20:00:00.000Z', 10, 5, {
      throwsBroken: 6, throwsMissed: 4, heatConverted: 3, heatWasted: 1,
    })];
    const inputs = kpiInputsForNode([
      { metric: 'throwBreakRate', op: '>=', value: 0.5, window: { kind: 'games', n: 10 }, minSample: 5 },
      { metric: 'heatWasteRate', op: '<=', value: 0.25, window: { kind: 'games', n: 10 }, minSample: 3 },
    ], [], sets);
    expect(inputs.map((i) => i.value)).toEqual([0.6, 0.25]);
  });

  it('omits metrics with no source data (verifiedShare, punishQuizAccuracy)', () => {
    const inputs = kpiInputsForNode([
      { metric: 'verifiedShare', op: '>=', value: 0.8, window: { kind: 'games', n: 10 }, minSample: 1 },
      { metric: 'punishQuizAccuracy', op: '>=', value: 0.8, window: { kind: 'games', n: 10 }, minSample: 1 },
    ], [], []);
    expect(inputs).toHaveLength(0);
  });

  it('uses only the most recent 10 games when more exist', () => {
    const old = matchSet('2026-10-20T20:00:00.000Z', 10, 5, { missedPunishes: 100 });
    const recent = matchSet('2026-10-30T20:00:00.000Z', 10, 5, { missedPunishes: 10 });
    const inputs = kpiInputsForNode(
      [{ metric: 'missedPunishesPerGame', op: '<=', value: 2, window: { kind: 'games', n: 10 }, minSample: 5 }],
      [],
      [old, recent],
    );
    // The window fills from the newest set: 10 games from `recent` alone.
    expect(inputs[0]?.value).toBeCloseTo(1.0);
  });
});
