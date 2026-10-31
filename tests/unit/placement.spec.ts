// P8: baseline placement (AC-ONB-5, G7) over the real repos
// (fake-indexeddb). G7-equivalent state is seeded through the repos in
// real-curriculum terms: the G7 fixture itself uses pre-curriculum node
// ids and metric names, so the seed below reproduces its evidence
// (drillSuccess, match tallies, quiz accuracies, solid nodes) with the
// curriculum's actual stages, nodes, drills and gates.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCurriculum } from '../../src/data/packs';
import {
  assessmentsRepo, masteryRepo, matchSetsRepo, resetDbForTests, setsRepo, stageStatusRepo,
} from '../../src/data/repos';
import type { MatchSet } from '../../src/data/schemas';
import { placementGate } from '../../src/domain/engine/gates';
import { accumulateQuizEvidence, gateEvidenceForStage } from '../../src/services/stages';
import { QUIZ_RESULT_KEYS, runPlacement } from '../../src/services/placement';

beforeEach(async () => {
  await resetDbForTests();
});

const NOW = '2026-10-29T12:00:00.000Z';
const DAY = '2026-10-29';

async function solidNodes(stageIndexes: number[]): Promise<void> {
  const curriculum = loadCurriculum();
  for (const stage of curriculum.stages.filter((s) => stageIndexes.includes(s.index))) {
    for (const nodeId of stage.nodeIds) {
      await masteryRepo.put({
        nodeId, K: null, E: null, A: null, score: 0.8, state: 'solid',
        placed: false, evidenceDays: [], updatedAt: NOW,
      });
    }
  }
}

async function seedSet(id: string, at: string, drillId: string, nodeId: string, successes: number): Promise<void> {
  await setsRepo.put({
    id, sessionId: 'seed-session', drillId, nodeId, at, day: DAY, reps: 10, successes,
  });
}

/** G7-equivalent evidence: drillSuccess + tallies + one quiz assessment. */
async function seedG7Evidence(): Promise<void> {
  await solidNodes([0, 1, 2, 3]);
  await seedSet('set-s1a', '2026-10-29T10:00:00.000Z', 'd1-punish-ladder', 'n1-punish', 9);
  await seedSet('set-s1b', '2026-10-29T10:01:00.000Z', 'd1-throw-breaks', 'n1-throws', 8);
  await seedSet('set-s1c', '2026-10-29T10:02:00.000Z', 'd1-guard', 'n1-guard', 9);
  await seedSet('set-s2a', '2026-10-29T10:03:00.000Z', 'd2-sidestep', 'n2-sidestep', 8);
  await seedSet('set-s2b', '2026-10-29T10:04:00.000Z', 'd2-whiff', 'n2-whiff', 8);
  await seedSet('set-s2c', '2026-10-29T10:05:00.000Z', 'd2-kbd', 'n2-kbd', 8);
  await seedSet('set-s3a', '2026-10-29T10:06:00.000Z', 'd3-bnb', 'n3-combos', 9);
  await seedSet('set-s3b', '2026-10-29T10:07:00.000Z', 'd3-core', 'n3-core', 8);
  await seedSet('set-s3c', '2026-10-29T10:08:00.000Z', 'd3-beginner-combo', 'n3-combos', 9);
  const matchSet: MatchSet = {
    id: 'match-1', at: NOW, day: DAY, mode: 'ranked', opponentCharacter: 'Kazuya',
    games: 10, wins: 5,
    tallies: {
      missedPunishes: 18, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
      spinEscaped: 0, spinPunished: 0, throwsBroken: 18, throwsMissed: 12,
      hitWhileMinus: 15, lowsBlocked: 0, lowsEaten: 0, heatConverted: 0,
      heatWasted: 0, okiConverted: 0,
    },
    beatBy: [], tags: [],
  };
  await matchSetsRepo.put(matchSet);
  await assessmentsRepo.put({
    id: 'assessment-seed', at: NOW, placementStage: 0,
    results: {
      [QUIZ_RESULT_KEYS.punishCorrect]: 36,
      [QUIZ_RESULT_KEYS.punishTotal]: 40,
      [QUIZ_RESULT_KEYS.notationCorrect]: 9,
      [QUIZ_RESULT_KEYS.notationTotal]: 10,
    },
  });
}

describe('runPlacement (AC-ONB-5, G7)', () => {
  it('empty DB places Stage 0, writes an assessment, and marks nothing passed', async () => {
    const outcome = await runPlacement(NOW);
    expect(outcome.placementStage).toBe(0);
    expect(outcome.assessment.placementStage).toBe(0);
    expect(outcome.assessment.results['punishQuizAccuracy']).toBe(0);
    expect(outcome.assessment.results['punishQuizSample']).toBe(0);
    expect(outcome.assessment.results['notationQuizAccuracy']).toBe(0);
    const statuses = await stageStatusRepo.all();
    expect(statuses.filter((s) => s.state === 'passed')).toHaveLength(0);
    expect(await masteryRepo.all()).toHaveLength(0);
    expect(await assessmentsRepo.all()).toHaveLength(1);
  });

  it('G7-equivalent state places Stage 4 with stages 0-3 passed viaPlacement', async () => {
    await seedG7Evidence();
    const outcome = await runPlacement(NOW);
    expect(outcome.placementStage).toBe(4);
    expect(outcome.stageResults.map((r) => r.passed)).toEqual([true, true, true, true]);
    for (const stageId of ['stage-0', 'stage-1', 'stage-2', 'stage-3']) {
      const status = await stageStatusRepo.get(stageId);
      expect(status).toMatchObject({ state: 'passed', passedAt: NOW, viaPlacement: true });
    }
    expect(await stageStatusRepo.get('stage-4')).toMatchObject({ state: 'open', viaPlacement: false });
    const curriculum = loadCurriculum();
    for (const stage of curriculum.stages.filter((s) => s.index <= 3)) {
      for (const nodeId of stage.nodeIds) {
        const row = await masteryRepo.get(nodeId);
        expect(row).toMatchObject({ state: 'solid', placed: true });
        expect(row?.score).toBe(0.8);
      }
    }
    expect(outcome.assessment.results['punishQuizAccuracy']).toBeCloseTo(0.9);
    expect(outcome.assessment.results['notationQuizAccuracy']).toBeCloseTo(0.9);
    expect(outcome.assessment.results['stage-1:punishQuizAccuracy']).toBeCloseTo(0.9);
  });

  it('only Stage 0 passing places Stage 1', async () => {
    await solidNodes([0]);
    await assessmentsRepo.put({
      id: 'assessment-seed', at: NOW, placementStage: 0,
      results: {
        [QUIZ_RESULT_KEYS.notationCorrect]: 9,
        [QUIZ_RESULT_KEYS.notationTotal]: 10,
      },
    });
    const outcome = await runPlacement(NOW);
    expect(outcome.placementStage).toBe(1);
    expect(await stageStatusRepo.get('stage-0')).toMatchObject({ state: 'passed', viaPlacement: true });
    const stage1 = await stageStatusRepo.get('stage-1');
    expect(stage1?.state).not.toBe('passed');
    expect((await masteryRepo.get('n1-guard'))).toBeUndefined();
  });

  it('never re-stamps an already-passed stage', async () => {
    await seedG7Evidence();
    const oldPassedAt = '2026-10-20T09:00:00.000Z';
    await stageStatusRepo.put({ stageId: 'stage-0', state: 'passed', passedAt: oldPassedAt, viaPlacement: false });
    await runPlacement(NOW);
    expect(await stageStatusRepo.get('stage-0')).toMatchObject({ passedAt: oldPassedAt, viaPlacement: false });
  });

  it('placement never skips a stage whose gate fails (stage 3 punish quiz too low)', async () => {
    await seedG7Evidence();
    // Replace the quiz assessment with one whose punish accuracy fails Stage 3 (0.9) but passes Stage 1 (0.85).
    await assessmentsRepo.remove('assessment-seed');
    await assessmentsRepo.put({
      id: 'assessment-seed-2', at: NOW, placementStage: 0,
      results: {
        [QUIZ_RESULT_KEYS.punishCorrect]: 35,
        [QUIZ_RESULT_KEYS.punishTotal]: 40,
        [QUIZ_RESULT_KEYS.notationCorrect]: 9,
        [QUIZ_RESULT_KEYS.notationTotal]: 10,
      },
    });
    const outcome = await runPlacement(NOW);
    expect(outcome.placementStage).toBe(3);
    expect(await stageStatusRepo.get('stage-3')).not.toMatchObject({ state: 'passed' });
  });
});

describe('quiz evidence accumulation', () => {
  it('two assessments (12 + 10 questions) satisfy the 20-question placement window', async () => {
    await assessmentsRepo.put({
      id: 'a-new', at: '2026-10-29T11:00:00.000Z', placementStage: 0,
      results: { [QUIZ_RESULT_KEYS.punishCorrect]: 11, [QUIZ_RESULT_KEYS.punishTotal]: 12 },
    });
    await assessmentsRepo.put({
      id: 'a-old', at: '2026-10-29T10:00:00.000Z', placementStage: 0,
      results: { [QUIZ_RESULT_KEYS.punishCorrect]: 9, [QUIZ_RESULT_KEYS.punishTotal]: 10 },
    });
    const evidence = await gateEvidenceForStage('stage-1');
    const punish = evidence.metrics['punishQuizAccuracy'];
    expect(punish?.sample).toBe(22);
    expect(punish?.value).toBeCloseTo(20 / 22);
    // The placement waiver needs only 20 questions: the sample check passes.
    const curriculum = loadCurriculum();
    const gate = curriculum.stages.find((s) => s.id === 'stage-1')?.gate;
    expect(gate).toBeDefined();
    if (gate !== undefined) {
      const waived = placementGate(gate);
      const punishCriterion = waived.criteria.find((c) => c.metric === 'punishQuizAccuracy');
      expect(punishCriterion?.minSample).toBe(20);
      expect(punish?.sample).toBeGreaterThanOrEqual(punishCriterion?.minSample ?? 0);
    }
  });

  it('stale assessments beyond the window are ignored (notation, 10-question window)', async () => {
    await assessmentsRepo.put({
      id: 'a-new', at: '2026-10-29T11:00:00.000Z', placementStage: 0,
      results: { [QUIZ_RESULT_KEYS.notationCorrect]: 10, [QUIZ_RESULT_KEYS.notationTotal]: 12 },
    });
    await assessmentsRepo.put({
      id: 'a-mid', at: '2026-10-29T10:00:00.000Z', placementStage: 0,
      results: { [QUIZ_RESULT_KEYS.notationCorrect]: 8, [QUIZ_RESULT_KEYS.notationTotal]: 10 },
    });
    await assessmentsRepo.put({
      id: 'a-stale', at: '2026-10-28T10:00:00.000Z', placementStage: 0,
      results: { [QUIZ_RESULT_KEYS.notationCorrect]: 0, [QUIZ_RESULT_KEYS.notationTotal]: 10 },
    });
    const evidence = await gateEvidenceForStage('stage-0');
    const notation = evidence.metrics['drillSuccess'];
    // Window is 10: only the newest assessment's first 10 questions count.
    expect(notation?.sample).toBe(10);
    expect(notation?.value).toBeCloseTo(10 / 12);
  });

  it('accumulateQuizEvidence caps at the window and ignores older rows', () => {
    const rows = [
      { id: 'a3', at: '2026-10-27T00:00:00.000Z', results: { c: 0, t: 10 }, placementStage: 0 },
      { id: 'a1', at: '2026-10-29T00:00:00.000Z', results: { c: 11, t: 12 }, placementStage: 0 },
      { id: 'a2', at: '2026-10-28T00:00:00.000Z', results: { c: 9, t: 10 }, placementStage: 0 },
    ];
    const result = accumulateQuizEvidence(rows, 'c', 't', 20);
    expect(result.sample).toBe(20);
    expect(result.value).toBeCloseTo((11 + 9 * (8 / 10)) / 20);
    expect(accumulateQuizEvidence([], 'c', 't', 20)).toEqual({ value: 0, sample: 0 });
  });
});
