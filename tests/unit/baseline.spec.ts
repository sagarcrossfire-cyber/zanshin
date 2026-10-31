// P8: baseline protocol shape + pack-derived quiz builders (spec §11.5),
// over the real repos (fake-indexeddb) for the session builder.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCurriculum, loadMovesYoshimitsu, loadPunishers } from '../../src/data/packs';
import { assessmentsRepo, resetDbForTests, sessionsRepo } from '../../src/data/repos';
import { bestPunisher } from '../../src/domain/engine/punish';
import { hashSeed } from '../../src/domain/engine/prng';
import { spokenLabel } from '../../src/domain/notation/speak';
import {
  appendExtensionBlocks, baselineSteps, buildBaselineSession, buildNotationQuestions,
  buildPunishQuestions, buildThrowSequence, coreMinutes, coreSteps, extensionSteps,
  extensionsOfferedFor, getLatestBaselineSession, isStepComplete, markStepComplete,
  stage1GatePasses, writeQuizAssessment,
} from '../../src/services/baseline';

beforeEach(async () => {
  await resetDbForTests();
});

describe('baseline protocol shape (§11.5)', () => {
  it('core steps run in order and total 48 minutes including matches', () => {
    const steps = coreSteps();
    expect(steps.map((s) => s.id)).toEqual([
      'setup', 'execution', 'punish-quiz', 'throw-quiz', 'notation-quiz', 'matches',
    ]);
    expect(steps.map((s) => s.minutes)).toEqual([3, 12, 10, 5, 3, 15]);
    expect(coreMinutes()).toBe(48);
    expect(baselineSteps()).toHaveLength(8);
  });

  it('extensions are 15 minutes each and gated on Stage 1', () => {
    expect(extensionSteps().map((s) => s.minutes)).toEqual([15, 15]);
    expect(extensionSteps().every((s) => s.extension === true)).toBe(true);
  });

  it('every drill step maps to real curriculum drills and nodes', () => {
    const curriculum = loadCurriculum();
    const drillIds = new Set(curriculum.drills.map((d) => d.id));
    const nodeIds = new Set(curriculum.nodes.map((n) => n.id));
    for (const step of baselineSteps()) {
      if (step.drillId !== undefined) {
        expect(drillIds.has(step.drillId), `step ${step.id} drill ${step.drillId}`).toBe(true);
      }
      for (const task of step.tasks ?? []) {
        expect(drillIds.has(task.drillId), `task ${task.id} drill ${task.drillId}`).toBe(true);
        expect(nodeIds.has(task.nodeId), `task ${task.id} node ${task.nodeId}`).toBe(true);
        expect(task.attempts).toBeGreaterThan(0);
      }
    }
  });

  it('stance entries cover all six §11.5 inputs, with the unmapped three on n0-baseline', () => {
    const execution = baselineSteps().find((s) => s.id === 'execution');
    const inputs = (execution?.tasks ?? []).map((t) => t.input);
    for (const input of ['u+1+2', '1+2', 'd+1+2', 'd+3+4', 'b+1+2', '3+4']) {
      expect(inputs).toContain(input);
    }
    const byInput = new Map((execution?.tasks ?? []).map((t) => [t.input, t]));
    expect(byInput.get('u+1+2')).toMatchObject({ drillId: 'd6-dgf-entries', nodeId: 'n6-dgf-entries' });
    expect(byInput.get('1+2')).toMatchObject({ drillId: 'd6-kincho', nodeId: 'n6-kincho' });
    expect(byInput.get('b+1+2')).toMatchObject({ drillId: 'd6-nss', nodeId: 'n6-nss' });
    for (const input of ['d+1+2', 'd+3+4', '3+4']) {
      expect(byInput.get(input)).toMatchObject({ nodeId: 'n0-baseline' });
    }
    expect(byInput.get('df+2')).toBeDefined();
  });

  it('execution maps beginner combo, BnB and core moves to real drills', () => {
    const execution = baselineSteps().find((s) => s.id === 'execution');
    const tasks = execution?.tasks ?? [];
    expect(tasks.find((t) => t.id === 'exec-beginner')).toMatchObject({ drillId: 'd3-beginner-combo', nodeId: 'n3-combos' });
    expect(tasks.find((t) => t.id === 'exec-bnb')).toMatchObject({ drillId: 'd3-bnb', nodeId: 'n3-combos' });
    expect(tasks.filter((t) => t.drillId === 'd3-core').map((t) => t.input).sort()).toEqual(['1+4', 'b+3']);
  });
});

describe('punish quiz builder (§11.5, §10.7)', () => {
  it('asks 20 questions: -6..-18 both postures Heat off, plus Heat-on -18', () => {
    const questions = buildPunishQuestions();
    expect(questions).toHaveLength(20);
    const combos = new Set(questions.map((q) => `${q.blockValue}|${q.posture}|${q.heatActive}`));
    for (const blockValue of [-6, -8, -10, -11, -13, -14, -15, -17, -18]) {
      expect(combos.has(`${blockValue}|standing|false`)).toBe(true);
      expect(combos.has(`${blockValue}|crouching|false`)).toBe(true);
    }
    expect(combos.has('-18|standing|true')).toBe(true);
    expect(combos.has('-18|crouching|true')).toBe(true);
  });

  it('every correct answer is the engine best punisher, with 4 distinct options', () => {
    const punishers = loadPunishers();
    for (const question of buildPunishQuestions(punishers)) {
      const best = bestPunisher(question.blockValue, question.posture, question.heatActive, punishers);
      expect(question.correctInput).toBe(best?.input);
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options).toContain(question.correctInput);
    }
  });
});

describe('notation quiz builder (§11.5)', () => {
  it('asks 10 questions with distinct inputs and spoken-label answers', () => {
    const questions = buildNotationQuestions(loadMovesYoshimitsu(), hashSeed('test-notation'));
    expect(questions).toHaveLength(10);
    expect(new Set(questions.map((q) => q.input)).size).toBe(10);
    for (const question of questions) {
      expect(question.correctLabel).toBe(spokenLabel(question.input));
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.options).toContain(question.correctLabel);
    }
  });

  it('is deterministic for a seed', () => {
    const a = buildNotationQuestions(loadMovesYoshimitsu(), 42);
    const b = buildNotationQuestions(loadMovesYoshimitsu(), 42);
    expect(a).toEqual(b);
  });
});

describe('throw sequence (§11.5)', () => {
  it('is deterministic, 20 throws, only the two generic throws, correct breaks', () => {
    const a = buildThrowSequence(1234);
    const b = buildThrowSequence(1234);
    expect(a).toEqual(b);
    expect(a).toHaveLength(20);
    for (const prompt of a) {
      expect(['1+3', '2+4']).toContain(prompt.throwInput);
      expect(prompt.breakInput).toBe(prompt.throwInput === '1+3' ? '1' : '2');
    }
  });

  it('different seeds give different orders', () => {
    expect(buildThrowSequence(1)).not.toEqual(buildThrowSequence(2));
  });
});

describe('extension gating', () => {
  it('extensions are offered only when Stage 1 gate evidence passes', async () => {
    const curriculum = loadCurriculum();
    const gate = curriculum.stages.find((s) => s.id === 'stage-1')?.gate;
    expect(gate).toBeDefined();
    if (gate === undefined) return;
    const passing = {
      nodes: [
        { nodeId: 'n1-guard', state: 'solid' },
        { nodeId: 'n1-frames', state: 'solid' },
        { nodeId: 'n1-punish', state: 'solid' },
        { nodeId: 'n1-punish-crouch', state: 'solid' },
        { nodeId: 'n1-throws', state: 'solid' },
        { nodeId: 'n1-wakeup', state: 'solid' },
      ],
      metrics: {
        punishQuizAccuracy: { value: 0.9, sample: 20 },
        drillSuccess: { value: 0.9, sample: 3 },
        throwBreakRate: { value: 0.7, sample: 30 },
        hitWhileMinusPerGame: { value: 1.0, sample: 10 },
      },
    };
    expect(extensionsOfferedFor(passing, gate)).toBe(true);
    const failing = {
      ...passing,
      metrics: { ...passing.metrics, punishQuizAccuracy: { value: 0.5, sample: 20 } },
    };
    expect(extensionsOfferedFor(failing, gate)).toBe(false);
    // Empty data never offers extensions.
    expect(await stage1GatePasses()).toBe(false);
  });
});

describe('baseline session persistence', () => {
  it('buildBaselineSession creates a baseline session with drill blocks', async () => {
    const session = await buildBaselineSession('2026-10-29T12:00:00.000Z');
    expect(session.kind).toBe('baseline');
    expect(session.status).toBe('active');
    expect(session.plannedMinutes).toBe(48);
    expect(session.blocks).toHaveLength(6);
    expect(session.blocks.map((b) => b.kind)).toEqual(['warmup', 'drill', 'review', 'review', 'review', 'application']);
    const drillIds = new Set(loadCurriculum().drills.map((d) => d.id));
    for (const block of session.blocks) {
      if (block.drillId !== undefined) expect(drillIds.has(block.drillId)).toBe(true);
    }
    expect(await getLatestBaselineSession()).toMatchObject({ id: session.id });
  });

  it('partial completion survives: completed blocks stay complete after reload', async () => {
    const session = await buildBaselineSession('2026-10-29T12:00:00.000Z');
    const updated = await markStepComplete(session, 'setup', '2026-10-29T12:03:00.000Z');
    expect(isStepComplete(updated, 'setup')).toBe(true);
    expect(isStepComplete(updated, 'execution')).toBe(false);
    const reloaded = await sessionsRepo.get(session.id);
    expect(reloaded !== undefined && isStepComplete(reloaded, 'setup')).toBe(true);
    const extended = await appendExtensionBlocks(updated, '2026-10-29T12:03:00.000Z');
    expect(extended.blocks).toHaveLength(8);
    const extendedAgain = await appendExtensionBlocks(extended, '2026-10-29T12:03:00.000Z');
    expect(extendedAgain.blocks).toHaveLength(8);
  });

  it('writeQuizAssessment writes one row per quiz with the canonical keys', async () => {
    await writeQuizAssessment('punish', 17.5, 20, '2026-10-29T12:00:00.000Z');
    await writeQuizAssessment('notation', 9, 10, '2026-10-29T12:01:00.000Z');
    const rows = await assessmentsRepo.all();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.results).toEqual({ punishQuizCorrect: 17.5, punishQuizTotal: 20 });
    expect(rows[1]?.results).toEqual({ notationQuizCorrect: 9, notationQuizTotal: 10 });
  });
});
