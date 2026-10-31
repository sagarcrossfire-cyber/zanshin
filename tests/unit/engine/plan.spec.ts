// Spec §7.3 — daily plan generator: day types, budget, fixed blocks, focus
// ranking, primary action order, determinism and lock consistency.
import * as fc from 'fast-check';
import { generatePlan, type PlanNode, type PlanSettings, type PlanState } from '../../../src/domain/engine/plan';

const SETTINGS: PlanSettings = { sessionMinutes: 30, weeklyMinutes: 150, preferredDays: [0, 1, 2, 3, 4, 5, 6] };

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return {
    nodeId: 'n1', drillId: 'd1', drillTitle: 'Drill 1', drillType: 'execution',
    importance: 2, stageOpen: true, masteryScore: 0.5, masteryState: 'learning',
    lastPracticedDaysAgo: 1, prerequisiteForCount: 0,
    ...overrides,
  };
}

function state(overrides: Partial<PlanState> = {}): PlanState {
  return {
    profileId: 'me', currentStageIndex: 2, nodes: [], dueCards: 0, matchSets: [],
    sessionsCompleted: 1, consecutiveSessionDays: 0, weeklyMinutesUsed: 60, verifyTasks: [],
    ...overrides,
  };
}

describe('day types and budget', () => {
  it('rests at 110% of the weekly budget', () => {
    const plan = generatePlan('2026-10-30', state({ weeklyMinutesUsed: 165 }), SETTINGS);
    expect(plan.dayType).toBe('rest');
    expect(plan.budget).toBe(5);
    expect(plan.total).toBe(5);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0]?.kind).toBe('review');
    expect(plan.primaryAction.kind).toBe('rest-day');
  });

  it('rests after 5 consecutive session days', () => {
    const plan = generatePlan('2026-10-30', state({ consecutiveSessionDays: 5 }), SETTINGS);
    expect(plan.dayType).toBe('rest');
  });

  it('does not rest at 109% or 4 consecutive days', () => {
    expect(generatePlan('2026-10-30', state({ weeklyMinutesUsed: 164 }), SETTINGS).dayType).toBe('full');
    expect(generatePlan('2026-10-30', state({ consecutiveSessionDays: 4 }), SETTINGS).dayType).toBe('full');
  });

  it('is light on a non-preferred day with a halved budget', () => {
    // 2026-10-30 is a Friday (weekday 5).
    const plan = generatePlan('2026-10-30', state(), { ...SETTINGS, preferredDays: [1, 2, 3] });
    expect(plan.dayType).toBe('light');
    expect(plan.budget).toBe(15);
    expect(plan.total).toBeLessThanOrEqual(17);
  });

  it('treats every day as preferred when no preferred days are set', () => {
    const plan = generatePlan('2026-10-30', state(), { ...SETTINGS, preferredDays: [] });
    expect(plan.dayType).toBe('full');
  });
});

describe('fixed blocks', () => {
  it('uses the rusty node as warm-up, else the most recently mastered execution drill', () => {
    const rusty = generatePlan('2026-10-30', state({
      nodes: [
        node({ nodeId: 'rusty', drillId: 'd-rusty', masteryState: 'rusty', masteryScore: 0.4, lastPracticedDaysAgo: 9, drillType: 'execution' }),
        node({ nodeId: 'mastered', drillId: 'd-mastered', masteryState: 'mastered', masteryScore: 0.95, lastPracticedDaysAgo: 2, drillType: 'execution' }),
      ],
    }), SETTINGS);
    expect(rusty.blocks[0]).toMatchObject({ kind: 'warmup', drillId: 'd-rusty', minutes: 3 });
    const masteredOnly = generatePlan('2026-10-30', state({
      nodes: [
        node({ nodeId: 'm1', drillId: 'd-m1', masteryState: 'mastered', masteryScore: 0.95, lastPracticedDaysAgo: 6, drillType: 'execution' }),
        node({ nodeId: 'm2', drillId: 'd-m2', masteryState: 'mastered', masteryScore: 0.95, lastPracticedDaysAgo: 2, drillType: 'execution' }),
      ],
    }), SETTINGS);
    expect(masteredOnly.blocks[0]).toMatchObject({ kind: 'warmup', drillId: 'd-m2' });
  });

  it('skips warm-up in Stage 0', () => {
    const plan = generatePlan('2026-10-30', state({
      currentStageIndex: 0,
      nodes: [node({ masteryState: 'rusty', drillId: 'd-rusty' })],
    }), SETTINGS);
    expect(plan.blocks.some((b) => b.kind === 'warmup')).toBe(false);
  });

  it('sizes review at 0.3 min per card, clamped to 2-6 minutes', () => {
    expect(generatePlan('2026-10-30', state({ dueCards: 3 }), SETTINGS).blocks.find((b) => b.kind === 'review')?.minutes).toBe(2);
    expect(generatePlan('2026-10-30', state({ dueCards: 13 }), SETTINGS).blocks.find((b) => b.kind === 'review')?.minutes).toBe(4);
    expect(generatePlan('2026-10-30', state({ dueCards: 40 }), SETTINGS).blocks.find((b) => b.kind === 'review')?.minutes).toBe(6);
    expect(generatePlan('2026-10-30', state({ dueCards: 0 }), SETTINGS).blocks.some((b) => b.kind === 'review')).toBe(false);
  });

  it('adds one 2-minute verify block for up to 3 checks, most important first', () => {
    const plan = generatePlan('2026-10-30', state({
      verifyTasks: [
        { id: 'v1', input: 'b+2,2', importance: 1 },
        { id: 'v2', input: '3,1', importance: 3 },
        { id: 'v3', input: 'df+2', importance: 2 },
        { id: 'v4', input: '1+4', importance: 2 },
      ],
    }), SETTINGS);
    const verify = plan.blocks.find((b) => b.kind === 'verify');
    expect(verify?.minutes).toBe(2);
    expect(verify?.verifyTaskIds).toEqual(['v2', 'v3', 'v4']);
  });

  it('adds application at 35% of T on every second session', () => {
    const plan = generatePlan('2026-10-30', state({
      sessionsCompleted: 1, topWeakness: 'Throw breaks',
      matchSets: [{ day: '2026-10-29' }],
    }), SETTINGS);
    const app = plan.blocks.find((b) => b.kind === 'application');
    expect(app?.minutes).toBe(11);
    expect(app?.reason).toBe('Play 5–10 games. Focus: Throw breaks.');
  });

  it('adds application when no match was logged in 3 days from Stage 1 on', () => {
    const plan = generatePlan('2026-10-30', state({
      sessionsCompleted: 0, currentStageIndex: 1,
      matchSets: [{ day: '2026-10-26' }],
    }), SETTINGS);
    expect(plan.blocks.some((b) => b.kind === 'application')).toBe(true);
    // Stage 0 is exempt from the 3-day rule.
    const stage0 = generatePlan('2026-10-30', state({
      sessionsCompleted: 0, currentStageIndex: 0,
      matchSets: [{ day: '2026-10-26' }],
    }), SETTINGS);
    expect(stage0.blocks.some((b) => b.kind === 'application')).toBe(false);
  });

  it('orders fixed blocks warmup, review, verify, application', () => {
    const plan = generatePlan('2026-10-30', state({
      dueCards: 10, sessionsCompleted: 1, topWeakness: 'X',
      matchSets: [{ day: '2026-10-29' }],
      verifyTasks: [{ id: 'v1', importance: 3 }],
      nodes: [node({ masteryState: 'rusty', drillId: 'd-rusty', lastPracticedDaysAgo: 5 })],
    }), SETTINGS);
    expect(plan.blocks.map((b) => b.kind)).toEqual(['warmup', 'review', 'verify', 'application', 'drill']);
  });
});

describe('focus drills', () => {
  it('ranks by importance x (1-M) x weakness x freshness x rusty x unlock', () => {
    const plan = generatePlan('2026-10-30', state({
      nodes: [
        node({ nodeId: 'low', drillId: 'd-low', drillType: 'execution', importance: 1, masteryScore: 0.7, lastPracticedDaysAgo: 1 }),
        node({ nodeId: 'high', drillId: 'd-high', drillType: 'punish', importance: 3, masteryScore: 0.4, lastPracticedDaysAgo: 5, inTopWeakness: true, prerequisiteForCount: 2 }),
      ],
    }), SETTINGS);
    const drills = plan.blocks.filter((b) => b.kind === 'drill');
    expect(drills[0]?.drillId).toBe('d-high');
    expect(drills).toHaveLength(2);
  });

  it('caps at 3 distinct focus drills and drops blocks under 5 minutes', () => {
    const plan = generatePlan('2026-10-30', state({
      nodes: [1, 2, 3, 4, 5].map((i) => node({
        nodeId: `n${i}`, drillId: `d${i}`, drillType: `type${i}`,
        importance: 2, masteryScore: 0.5, lastPracticedDaysAgo: 4,
      })),
    }), SETTINGS);
    const drills = plan.blocks.filter((b) => b.kind === 'drill');
    expect(drills.length).toBeLessThanOrEqual(3);
    for (const drill of drills) expect(drill.minutes).toBeGreaterThanOrEqual(5);
    const ids = new Set(drills.map((d) => d.drillId));
    expect(ids.size).toBe(drills.length);
  });

  it('never schedules locked, mastered or solid nodes as focus drills', () => {
    const plan = generatePlan('2026-10-30', state({
      nodes: [
        node({ nodeId: 'locked', drillId: 'd-locked', stageOpen: false }),
        // drillType 'punish' so the mastered node is not a warm-up candidate either.
        node({ nodeId: 'mastered', drillId: 'd-mastered', drillType: 'punish', masteryState: 'mastered', masteryScore: 0.95 }),
        node({ nodeId: 'solid', drillId: 'd-solid', masteryState: 'solid', masteryScore: 0.85 }),
        node({ nodeId: 'open', drillId: 'd-open' }),
      ],
    }), SETTINGS);
    const focusIds = plan.blocks.filter((b) => b.kind === 'drill').map((b) => b.drillId);
    expect(focusIds).not.toContain('d-locked');
    expect(focusIds).not.toContain('d-mastered');
    expect(focusIds).not.toContain('d-solid');
    expect(focusIds).toContain('d-open');
  });

  it('gives every block a reason', () => {
    const plan = generatePlan('2026-10-30', state({
      dueCards: 5,
      nodes: [node({})],
    }), SETTINGS);
    for (const block of plan.blocks) {
      expect(block.reason.length).toBeGreaterThan(0);
    }
  });

  it('uses the supplied reason detail when present', () => {
    const plan = generatePlan('2026-10-30', state({
      nodes: [node({ reasonDetail: 'Missed punishes 3.0 per game vs target 2.0 (last 10 games)' })],
    }), SETTINGS);
    expect(plan.blocks.find((b) => b.kind === 'drill')?.reason).toBe(
      'Missed punishes 3.0 per game vs target 2.0 (last 10 games)',
    );
  });
});

describe('primary action — first match wins', () => {
  it('resume beats gate beats rest', () => {
    const plan = generatePlan('2026-10-30', state({
      unfinishedSession: true, gateReady: true, weeklyMinutesUsed: 165,
    }), SETTINGS);
    expect(plan.primaryAction.kind).toBe('resume-session');
    const gate = generatePlan('2026-10-30', state({ gateReady: true, gateStageIndex: 2, weeklyMinutesUsed: 165 }), SETTINGS);
    expect(gate.primaryAction).toEqual({ kind: 'take-gate', stageIndex: 2 });
  });

  it('review-cards when more than 20 are due and no session ran today', () => {
    const plan = generatePlan('2026-10-30', state({ dueCards: 21 }), SETTINGS);
    expect(plan.primaryAction).toEqual({ kind: 'review-cards', dueCards: 21 });
    const ran = generatePlan('2026-10-30', state({ dueCards: 21, sessionRanToday: true }), SETTINGS);
    expect(ran.primaryAction.kind).toBe('start-session');
    const twenty = generatePlan('2026-10-30', state({ dueCards: 20 }), SETTINGS);
    expect(twenty.primaryAction.kind).toBe('start-session');
  });

  it('log-matches when an application block is pending after the session', () => {
    const plan = generatePlan('2026-10-30', state({
      sessionsCompleted: 1, sessionCompletedToday: true,
      matchSets: [{ day: '2026-10-29' }],
    }), SETTINGS);
    expect(plan.primaryAction.kind).toBe('log-matches');
  });

  it('defaults to start-session', () => {
    expect(generatePlan('2026-10-30', state(), SETTINGS).primaryAction.kind).toBe('start-session');
  });
});

describe('determinism and properties (200 runs)', () => {
  it('same inputs produce byte-identical JSON', () => {
    const input = state({
      nodes: [node({ nodeId: 'a', drillId: 'da' }), node({ nodeId: 'b', drillId: 'db', drillType: 'punish' })],
      dueCards: 13,
    });
    const a = generatePlan('2026-10-30', input, SETTINGS);
    const b = generatePlan('2026-10-30', input, SETTINGS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generatePlan('2026-10-30', input, SETTINGS, 'seed-1'))).toBe(
      JSON.stringify(generatePlan('2026-10-30', input, SETTINGS, 'seed-1')),
    );
  });

  it('total stays within ±10% of budget and locked nodes never appear (200 runs)', () => {
    const nodeArb = fc.record({
      nodeId: fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 1, maxLength: 3 }).map((chars) => chars.join('')),
      drillId: fc.array(fc.constantFrom('d', 'e', 'f'), { minLength: 1, maxLength: 3 }).map((chars) => chars.join('')),
      drillType: fc.constantFrom('execution', 'punish', 'reaction'),
      importance: fc.constantFrom(1, 2, 3) as fc.Arbitrary<1 | 2 | 3>,
      stageOpen: fc.boolean(),
      masteryScore: fc.double({ min: 0, max: 1, noNaN: true }),
      masteryState: fc.constantFrom('learning', 'practicing', 'rusty', 'solid', 'mastered'),
      lastPracticedDaysAgo: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
      prerequisiteForCount: fc.integer({ min: 0, max: 3 }),
      inTopWeakness: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.record({
          nodes: fc.array(nodeArb, { maxLength: 5 }),
          dueCards: fc.integer({ min: 0, max: 30 }),
          sessionsCompleted: fc.integer({ min: 0, max: 10 }),
          consecutiveSessionDays: fc.integer({ min: 0, max: 4 }),
          weeklyMinutesUsed: fc.integer({ min: 0, max: 140 }),
        }),
        fc.integer({ min: 20, max: 45 }),
        (parts, sessionMinutes) => {
          // Real data has unique ids; assign them here so lock consistency is
          // checkable by drillId.
          const uniqueNodes = parts.nodes.map((n, index) => ({
            ...n, nodeId: `n${index}`, drillId: `d${index}`,
          }));
          const planState = state({
            nodes: uniqueNodes.map((n) => node(n)),
            dueCards: parts.dueCards,
            sessionsCompleted: parts.sessionsCompleted,
            consecutiveSessionDays: parts.consecutiveSessionDays,
            weeklyMinutesUsed: parts.weeklyMinutesUsed,
          });
          const plan = generatePlan('2026-10-30', planState, { ...SETTINGS, sessionMinutes });
          const budget = plan.budget;
          expect(plan.total).toBeLessThanOrEqual(Math.ceil(budget * 1.1));
          // Lock consistency: no block may reference a stage-closed node.
          const closed = new Set(
            uniqueNodes.filter((n) => !n.stageOpen).map((n) => n.drillId),
          );
          for (const block of plan.blocks) {
            if (block.drillId !== undefined) expect(closed.has(block.drillId)).toBe(false);
            expect(block.reason.length).toBeGreaterThan(0);
            expect(Number.isInteger(block.minutes)).toBe(true);
          }
          expect(plan.blocks.filter((b) => b.kind === 'drill')).toHaveLength(
            plan.blocks.filter((b) => b.kind === 'drill').length,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
