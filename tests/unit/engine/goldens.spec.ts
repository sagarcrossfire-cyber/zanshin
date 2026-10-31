// Spec §7.9 / §13.5 — engine goldens. Fixtures in tests/fixtures/engine,
// expected outputs in tests/golden (see its README for hand verification).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adaptationForDrill, plateauDecision, progressionDecision, regressionDecision } from '../../../src/domain/engine/adapt';
import { computeMastery } from '../../../src/domain/engine/mastery';
import { evaluatePlacement, evaluateStageStatus, placementGate } from '../../../src/domain/engine/gates';
import { applyPatchImpact } from '../../../src/domain/engine/patch';
import { generatePlan } from '../../../src/domain/engine/plan';
import { detectWeaknesses } from '../../../src/domain/engine/weakness';

function loadJson<T>(relative: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), relative), 'utf8')) as T;
}

describe('engine goldens', () => {
  it('G1 — day 1, no data', () => {
    const fixture = loadJson<{ date: string; state: Parameters<typeof generatePlan>[1]; settings: Parameters<typeof generatePlan>[2] }>('tests/fixtures/engine/G1.json');
    const expected = loadJson<unknown>('tests/golden/G1.expected.json');
    expect(generatePlan(fixture.date, fixture.state, fixture.settings)).toEqual(expected);
  });

  it('G2 — Stage 1 passes on the gate day; Stage 2 is open next', () => {
    const fixture = loadJson<{ stages: { stage: Parameters<typeof evaluateStageStatus>[0]; evidence: Parameters<typeof evaluateStageStatus>[1] }[] }>('tests/fixtures/engine/G2.json');
    const expected = loadJson<unknown>('tests/golden/G2.expected.json');
    const stage1 = fixture.stages[0] as { stage: Parameters<typeof evaluateStageStatus>[0]; evidence: Parameters<typeof evaluateStageStatus>[1] };
    const stage2 = fixture.stages[1] as { stage: Parameters<typeof evaluateStageStatus>[0]; evidence: Parameters<typeof evaluateStageStatus>[1] };
    const status1 = evaluateStageStatus(stage1.stage, stage1.evidence, { previousState: 'open', previousStagePassed: true });
    const status2 = evaluateStageStatus(stage2.stage, stage2.evidence, { previousState: 'locked', previousStagePassed: status1.passed });
    expect({ stage1: status1, stage2: status2 }).toEqual(expected);
  });

  it('G3 — plateau flagged, drill spaced (see tests/golden/README.md for the §7.5 note)', () => {
    const fixture = loadJson<{ drill: Parameters<typeof adaptationForDrill>[0]; sets: Parameters<typeof adaptationForDrill>[1]; executions: number[] }>('tests/fixtures/engine/G3.json');
    const expected = loadJson<unknown>('tests/golden/G3.expected.json');
    expect({
      progression: progressionDecision(fixture.drill, fixture.sets),
      regression: regressionDecision(fixture.drill, fixture.sets),
      plateau: plateauDecision(fixture.drill, fixture.executions),
      combined: adaptationForDrill(fixture.drill, fixture.sets, fixture.executions),
    }).toEqual(expected);
  });

  it('G4 — mastered node untouched 30 days is Rusty and becomes the warm-up', () => {
    const fixture = loadJson<{ masteryInput: Parameters<typeof computeMastery>[0]; plan: { date: string; state: Parameters<typeof generatePlan>[1]; settings: Parameters<typeof generatePlan>[2] } }>('tests/fixtures/engine/G4.json');
    const expected = loadJson<unknown>('tests/golden/G4.expected.json');
    expect({
      mastery: computeMastery(fixture.masteryInput),
      plan: generatePlan(fixture.plan.date, fixture.plan.state, fixture.plan.settings),
    }).toEqual(expected);
  });

  it('G5 — 10 games at 3.0 missed punishes per game', () => {
    const fixture = loadJson<{ act: 'shu'; matchSets: Parameters<typeof detectWeaknesses>[0]; plan: { date: string; state: Parameters<typeof generatePlan>[1]; settings: Parameters<typeof generatePlan>[2] } }>('tests/fixtures/engine/G5.json');
    const expected = loadJson<unknown>('tests/golden/G5.expected.json');
    expect({
      weaknesses: detectWeaknesses(fixture.matchSets, fixture.act),
      plan: generatePlan(fixture.plan.date, fixture.plan.state, fixture.plan.settings),
    }).toEqual(expected);
  });

  it('G6 — patch changes b+2,2 on block from -13 to -9', () => {
    const fixture = loadJson<{ diff: Parameters<typeof applyPatchImpact>[0]; state: Parameters<typeof applyPatchImpact>[1] }>('tests/fixtures/engine/G6.json');
    const expected = loadJson<unknown>('tests/golden/G6.expected.json');
    expect(applyPatchImpact(fixture.diff, fixture.state)).toEqual(expected);
  });

  it('G7 — baseline meets Stage 1-3 gates, fails Stage 4', () => {
    const fixture = loadJson<{ stages: { index: number; gate: Parameters<typeof evaluatePlacement>[0][number]['gate']; evidence: Parameters<typeof evaluatePlacement>[0][number]['evidence']; stageId: string }[] }>('tests/fixtures/engine/G7.json');
    const expected = loadJson<unknown>('tests/golden/G7.expected.json');
    const placement = evaluatePlacement(
      fixture.stages.map((s) => ({ index: s.index, gate: s.gate, evidence: s.evidence })),
    );
    const statuses: unknown[] = [];
    let prevPassed = false;
    fixture.stages.forEach((s, i) => {
      const isPlacementStage = s.index <= 3;
      const gate = isPlacementStage ? placementGate(s.gate) : s.gate;
      const result = evaluateStageStatus(
        { id: s.stageId, index: s.index, gate },
        s.evidence,
        i === 0
          ? { viaPlacement: isPlacementStage }
          : { previousState: 'locked', previousStagePassed: prevPassed, viaPlacement: isPlacementStage },
      );
      statuses.push(result);
      prevPassed = result.passed;
    });
    expect({ placementStage: placement, statuses }).toEqual(expected);
  });

  it('G8 — 20-minute session budget', () => {
    const fixture = loadJson<{ date: string; state: Parameters<typeof generatePlan>[1]; settings: Parameters<typeof generatePlan>[2] }>('tests/fixtures/engine/G8.json');
    const expected = loadJson<unknown>('tests/golden/G8.expected.json');
    const plan = generatePlan(fixture.date, fixture.state, fixture.settings);
    expect(plan).toEqual(expected);
    expect(plan.total).toBeGreaterThanOrEqual(18);
    expect(plan.total).toBeLessThanOrEqual(22);
    for (const block of plan.blocks.filter((b) => b.kind === 'drill')) {
      expect(block.minutes).toBeGreaterThanOrEqual(5);
    }
  });

  it('G9 — rest-day plan', () => {
    const fixture = loadJson<{ date: string; state: Parameters<typeof generatePlan>[1]; settings: Parameters<typeof generatePlan>[2] }>('tests/fixtures/engine/G9.json');
    const expected = loadJson<unknown>('tests/golden/G9.expected.json');
    expect(generatePlan(fixture.date, fixture.state, fixture.settings)).toEqual(expected);
  });

  it('G10 — same state and date, run twice: byte-identical plan JSON', () => {
    const fixture = loadJson<{ date: string; state: Parameters<typeof generatePlan>[1]; settings: Parameters<typeof generatePlan>[2] }>('tests/fixtures/engine/G10.json');
    const expected = loadJson<unknown>('tests/golden/G10.expected.json');
    const first = generatePlan(fixture.date, fixture.state, fixture.settings);
    const second = generatePlan(fixture.date, fixture.state, fixture.settings);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(expected));
  });
});
