// Spec §7.1 — mastery formulas, null components, decay, states.
import * as fc from 'fast-check';
import { computeMastery, type MasteryInput } from '../../../src/domain/engine/mastery';

function base(overrides: Partial<MasteryInput> = {}): MasteryInput {
  return {
    nodeId: 'n1',
    hasKnowledge: false,
    hasExecution: false,
    hasApplication: false,
    cards: [],
    sets: [],
    kpis: [],
    now: '2026-10-30',
    ...overrides,
  };
}

describe('computeMastery — K', () => {
  it('is the Good/Easy, not-overdue share of cards', () => {
    const result = computeMastery(base({
      hasKnowledge: true,
      cards: [
        { grade: 3, overdue: false }, { grade: 2, overdue: false },
        { grade: 1, overdue: false }, { grade: 3, overdue: true },
      ],
    }));
    expect(result.K).toBeCloseTo(0.5);
    expect(result.score).toBeCloseTo(0.5);
    expect(result.state).toBe('practicing');
  });

  it('is null with no cards and no quiz evidence', () => {
    expect(computeMastery(base({ hasKnowledge: true })).K).toBeNull();
  });

  it('averages the card share with punish-quiz accuracy for punish nodes', () => {
    const result = computeMastery(base({
      hasKnowledge: true,
      isPunishNode: true,
      cards: [{ grade: 3, overdue: false }, { grade: 3, overdue: false }],
      punishQuizAccuracy: 0.8,
    }));
    expect(result.K).toBeCloseTo(0.9);
  });

  it('uses quiz accuracy alone when a punish node has no cards', () => {
    const result = computeMastery(base({
      hasKnowledge: true, isPunishNode: true, punishQuizAccuracy: 0.75,
    }));
    expect(result.K).toBeCloseTo(0.75);
  });
});

describe('computeMastery — E', () => {
  const sets = [
    { successes: 8, reps: 10, at: '2026-10-28T20:00:00Z', day: '2026-10-28' },
    { successes: 9, reps: 10, at: '2026-10-29T20:00:00Z', day: '2026-10-29' },
    { successes: 10, reps: 10, at: '2026-10-30T20:00:00Z', day: '2026-10-30' },
  ];

  it('weights the last 5 sets newest-first and divides by target, capped at 1', () => {
    // Newest first: 1.0*1.0 + 0.9*0.8 + 0.8*0.6 = 2.2; /2.4 = 0.9167; /0.8 = 1.1458 -> cap 1.
    const result = computeMastery(base({ hasExecution: true, sets, drillTarget: 0.8 }));
    expect(result.E).toBeCloseTo(1);
  });

  it('uses only the last 5 sets', () => {
    const many = [
      { successes: 0, reps: 10, at: '2026-10-20T20:00:00Z', day: '2026-10-20' },
      { successes: 0, reps: 10, at: '2026-10-21T20:00:00Z', day: '2026-10-21' },
      ...sets,
      { successes: 10, reps: 10, at: '2026-10-30T21:00:00Z', day: '2026-10-30' },
      { successes: 10, reps: 10, at: '2026-10-30T22:00:00Z', day: '2026-10-30' },
    ];
    const result = computeMastery(base({ hasExecution: true, sets: many, drillTarget: 1 }));
    // Last 5 newest-first: 1.0, 1.0, 1.0, 0.9, 0.8, weighted (1+0.8+0.6+0.36+0.16)/3 = 0.9733.
    expect(result.E).toBeCloseTo(0.9733);
  });

  it('halves every 14 days without practice', () => {
    const fresh = computeMastery(base({
      hasExecution: true, drillTarget: 1,
      sets: [{ successes: 8, reps: 10, at: '2026-10-30T20:00:00Z', day: '2026-10-30' }],
    }));
    const stale = computeMastery(base({
      hasExecution: true, drillTarget: 1,
      sets: [{ successes: 8, reps: 10, at: '2026-10-16T20:00:00Z', day: '2026-10-16' }],
    }));
    expect(fresh.E).toBeCloseTo(0.8);
    expect(stale.E).toBeCloseTo(0.4);
    const veryStale = computeMastery(base({
      hasExecution: true, drillTarget: 1,
      sets: [{ successes: 8, reps: 10, at: '2026-10-02T20:00:00Z', day: '2026-10-02' }],
    }));
    expect(veryStale.E).toBeCloseTo(0.2);
  });

  it('is null with no sets or no target', () => {
    expect(computeMastery(base({ hasExecution: true, drillTarget: 0.8 })).E).toBeNull();
    expect(computeMastery(base({ hasExecution: true, sets })).E).toBeNull();
  });
});

describe('computeMastery — A and M', () => {
  it('lower-is-better uses target/value, higher uses value/target, clamped 0-1', () => {
    const result = computeMastery(base({
      hasApplication: true,
      kpis: [
        { direction: 'lower', target: 2, value: 4, sample: 10, minSample: 5 }, // 0.5
        { direction: 'higher', target: 0.5, value: 0.75, sample: 10, minSample: 5 }, // 1.5 -> 1
      ],
    }));
    expect(result.A).toBeCloseTo(0.75);
  });

  it('skips KPIs below their minimum sample', () => {
    const result = computeMastery(base({
      hasApplication: true,
      kpis: [
        { direction: 'lower', target: 2, value: 4, sample: 4, minSample: 5 },
        { direction: 'higher', target: 0.5, value: 0.25, sample: 10, minSample: 5 }, // 0.5
      ],
    }));
    expect(result.A).toBeCloseTo(0.5);
  });

  it('is null when every KPI is below its minimum sample', () => {
    expect(computeMastery(base({
      hasApplication: true,
      kpis: [{ direction: 'lower', target: 2, value: 1, sample: 1, minSample: 5 }],
    })).A).toBeNull();
  });

  it('weights only non-null components', () => {
    // K=1 (weight .2), E=1 (weight .5) -> M = 0.7/0.7 = 1.
    const result = computeMastery(base({
      hasKnowledge: true, hasExecution: true,
      cards: [{ grade: 3, overdue: false }],
      sets: [{ successes: 10, reps: 10, at: '2026-10-30T20:00:00Z', day: '2026-10-30' }],
      drillTarget: 1,
    }));
    expect(result.score).toBeCloseTo(1);
  });

  it('is 0 when every component is null', () => {
    const result = computeMastery(base());
    expect(result.score).toBe(0);
    expect(result.K).toBeNull();
    expect(result.E).toBeNull();
    expect(result.A).toBeNull();
    expect(result.state).toBe('learning');
  });

  it('handles a zero value for a lower-is-better KPI as perfect', () => {
    const result = computeMastery(base({
      hasApplication: true,
      kpis: [{ direction: 'lower', target: 2, value: 0, sample: 10, minSample: 5 }],
    }));
    expect(result.A).toBe(1);
  });
});

describe('computeMastery — states', () => {
  it('thresholds: <0.50 learning, 0.50-0.79 practicing, >=0.80 solid', () => {
    const at = (score: number): string => computeMastery(base({
      hasApplication: true,
      kpis: [{ direction: 'higher', target: 1, value: score, sample: 10, minSample: 5 }],
    })).state;
    expect(at(0.49)).toBe('learning');
    expect(at(0.5)).toBe('practicing');
    expect(at(0.79)).toBe('practicing');
    expect(at(0.8)).toBe('solid');
  });

  it('mastered needs >=0.90, 2 evidence days and 3 sets in the window', () => {
    const sets = [
      { successes: 10, reps: 10, at: '2026-10-29T20:00:00Z', day: '2026-10-29' },
      { successes: 10, reps: 10, at: '2026-10-30T20:00:00Z', day: '2026-10-30' },
      { successes: 10, reps: 10, at: '2026-10-30T21:00:00Z', day: '2026-10-30' },
    ];
    const result = computeMastery(base({ hasExecution: true, sets, drillTarget: 1 }));
    expect(result.score).toBeCloseTo(1);
    expect(result.state).toBe('mastered');
    // Same score, one evidence day only -> solid.
    const oneDay = computeMastery(base({
      hasExecution: true,
      sets: sets.map((s) => ({ ...s, day: '2026-10-30' })),
      drillTarget: 1,
    }));
    expect(oneDay.state).toBe('solid');
    // Same score, only 2 sets -> solid.
    const twoSets = computeMastery(base({
      hasExecution: true, sets: sets.slice(0, 2), drillTarget: 1,
    }));
    expect(twoSets.state).toBe('solid');
  });

  it('rusty when previously solid/mastered and M drops below 0.80', () => {
    const result = computeMastery(base({
      hasApplication: true, previousState: 'solid',
      kpis: [{ direction: 'higher', target: 1, value: 0.6, sample: 10, minSample: 5 }],
    }));
    expect(result.state).toBe('rusty');
    // A previously-learning node at the same score is practicing, not rusty.
    const fresh = computeMastery(base({
      hasApplication: true, previousState: 'learning',
      kpis: [{ direction: 'higher', target: 1, value: 0.6, sample: 10, minSample: 5 }],
    }));
    expect(fresh.state).toBe('practicing');
    // Rusty stays rusty while still below 0.80.
    const stays = computeMastery(base({
      hasApplication: true, previousState: 'rusty',
      kpis: [{ direction: 'higher', target: 1, value: 0.4, sample: 10, minSample: 5 }],
    }));
    expect(stays.state).toBe('rusty');
  });

  it('locked overrides every other state', () => {
    const result = computeMastery(base({
      hasApplication: true, stageOpen: false,
      kpis: [{ direction: 'higher', target: 1, value: 1, sample: 10, minSample: 5 }],
    }));
    expect(result.state).toBe('locked');
    expect(result.score).toBeCloseTo(1);
    const prereq = computeMastery(base({
      hasApplication: true, prerequisitesMet: false,
      kpis: [{ direction: 'higher', target: 1, value: 1, sample: 10, minSample: 5 }],
    }));
    expect(prereq.state).toBe('locked');
  });

  it('placed nodes start Solid at exactly 0.80 until real evidence arrives', () => {
    const placed = computeMastery(base({ placed: true }));
    expect(placed.score).toBe(0.8);
    expect(placed.state).toBe('solid');
    expect(placed.placed).toBe(true);
    // First real evidence replaces the placement.
    const evidenced = computeMastery(base({
      placed: true, hasApplication: true,
      kpis: [{ direction: 'higher', target: 1, value: 0.4, sample: 10, minSample: 5 }],
    }));
    expect(evidenced.placed).toBe(false);
    expect(evidenced.score).toBeCloseTo(0.4);
  });
});

describe('computeMastery — properties (200 runs)', () => {
  it('score and components always stay in 0..1, and results are deterministic', () => {
    const arb = fc.record({
      cards: fc.array(fc.record({ grade: fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<0 | 1 | 2 | 3>, overdue: fc.boolean() }), { maxLength: 8 }),
      sets: fc.array(
        fc.record({
          successes: fc.integer({ min: 0, max: 10 }),
          reps: fc.integer({ min: 1, max: 10 }),
          at: fc.constantFrom('2026-10-29T20:00:00Z', '2026-10-30T20:00:00Z'),
          day: fc.constantFrom('2026-10-29', '2026-10-30'),
        }),
        { maxLength: 6 },
      ),
      kpis: fc.array(
        fc.record({
          direction: fc.constantFrom('lower', 'higher') as fc.Arbitrary<'lower' | 'higher'>,
          target: fc.double({ min: 0.1, max: 5, noNaN: true }),
          value: fc.double({ min: 0, max: 5, noNaN: true }),
          sample: fc.integer({ min: 0, max: 20 }),
          minSample: fc.integer({ min: 1, max: 10 }),
        }),
        { maxLength: 3 },
      ),
      quiz: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
    });
    fc.assert(
      fc.property(arb, (parts) => {
        const input = base({
          hasKnowledge: true, hasExecution: true, hasApplication: true,
          isPunishNode: true, drillTarget: 0.8,
          cards: parts.cards, sets: parts.sets, kpis: parts.kpis,
          punishQuizAccuracy: parts.quiz ?? null,
        });
        const a = computeMastery(input);
        const b = computeMastery(input);
        expect(a).toEqual(b);
        expect(a.score).toBeGreaterThanOrEqual(0);
        expect(a.score).toBeLessThanOrEqual(1);
        for (const component of [a.K, a.E, a.A]) {
          if (component !== null) {
            expect(component).toBeGreaterThanOrEqual(0);
            expect(component).toBeLessThanOrEqual(1);
          }
        }
        expect(['locked', 'learning', 'practicing', 'solid', 'mastered', 'rusty']).toContain(a.state);
      }),
      { numRuns: 200 },
    );
  });
});
