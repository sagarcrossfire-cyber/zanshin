// P5: verify recording (AC-LAB-6) and mastery recalculation after a set
// (AC-LAB-4), over the real repos (fake-indexeddb).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { conflictsRepo, masteryRepo, resetDbForTests, verificationsRepo } from '../../../src/data/repos';
import { recordVerification, recomputeNodeMastery, logSet } from '../../../src/services/lab';

beforeEach(async () => {
  await resetDbForTests();
});

const CONFLICT = {
  id: 'conflict-1',
  entityId: 'Yoshimitsu-b+2,2',
  field: 'block',
  values: [
    { source: 'wavu', value: '-9' },
    { source: 'tekkendocs', value: '-10' },
  ],
  status: 'open' as const,
};

describe('verify recording (AC-LAB-6)', () => {
  it('a Match resolves the conflict with the confirmed value', async () => {
    await conflictsRepo.put(CONFLICT);
    const { record, conflict } = await recordVerification({
      entityId: 'Yoshimitsu-b+2,2',
      field: 'block',
      expected: '-9',
      observed: '-9',
      result: 'match',
      patch: '3.02.02',
      nowIso: '2026-10-29T20:00:00.000Z',
    });
    expect(record.result).toBe('match');
    expect(conflict?.status).toBe('resolved');
    expect(conflict?.resolution).toContain('-9');
    expect(await conflictsRepo.allOpen()).toHaveLength(0);
    expect(await verificationsRepo.allByEntity('Yoshimitsu-b+2,2')).toHaveLength(1);
  });

  it('a Mismatch keeps the conflict open and appends the Practice observation', async () => {
    await conflictsRepo.put(CONFLICT);
    const { conflict } = await recordVerification({
      entityId: 'Yoshimitsu-b+2,2',
      field: 'block',
      expected: '-9',
      observed: '-11',
      result: 'mismatch',
      patch: '3.02.02',
      nowIso: '2026-10-29T20:00:00.000Z',
    });
    expect(conflict?.status).toBe('open');
    expect(conflict?.values).toContainEqual({ source: 'practice', value: '-11' });
    expect(await conflictsRepo.allOpen()).toHaveLength(1);
  });

  it('a Mismatch with no backing conflict creates one', async () => {
    const { conflict } = await recordVerification({
      entityId: 'Yoshimitsu-1+4',
      field: 'block',
      expected: '-20',
      observed: '-19',
      result: 'mismatch',
      patch: '3.02.02',
      nowIso: '2026-10-29T20:00:00.000Z',
    });
    expect(conflict?.status).toBe('open');
    expect(conflict?.values).toHaveLength(2);
  });
});

describe('mastery recalculation (AC-LAB-4)', () => {
  it('logging a set creates/updates the node mastery record', async () => {
    await logSet({
      sessionId: 'session-1',
      drillId: 'd0-notation',
      nodeId: 'n0-controls',
      reps: 10,
      successes: 8,
      now: new Date('2026-10-29T20:00:00.000Z'),
    });
    const mastery = await masteryRepo.get('n0-controls');
    expect(mastery).toBeDefined();
    expect(mastery?.evidenceDays).toContain('2026-10-29');
    await recomputeNodeMastery('n0-controls', '2026-10-29T20:00:00.000Z');
    const again = await masteryRepo.get('n0-controls');
    expect(again?.updatedAt).toBeDefined();
  });
});

// RCA 2026-11-01: 1.x saved every Stage 1+ lesson as "locked" when it was
// practised (stageOpen was `stageIndex === 0`), so no stage after Stage 0
// could ever pass its gate.
describe('mastery respects the stored stage status (2.0 fix)', () => {
  it('a Stage 1 lesson practised while Stage 1 is open is not saved as locked', async () => {
    const { stageStatusRepo } = await import('../../../src/data/repos');
    await stageStatusRepo.put({ stageId: 'stage-0', state: 'passed', viaPlacement: false, passedAt: '2026-10-30T20:00:00.000Z' });
    await stageStatusRepo.put({ stageId: 'stage-1', state: 'open', viaPlacement: false });
    const days = ['2026-10-29', '2026-10-30', '2026-10-31'];
    for (const day of days) {
      await logSet({ sessionId: 's1', drillId: 'd1-guard', nodeId: 'n1-guard', reps: 10, successes: 10, now: new Date(`${day}T20:00:00.000Z`) });
    }
    const row = await masteryRepo.get('n1-guard');
    expect(row?.state).not.toBe('locked');
    expect(['solid', 'mastered']).toContain(row?.state);
  });

  it('a lesson in a stage that is still locked stays locked', async () => {
    const { stageStatusRepo } = await import('../../../src/data/repos');
    await stageStatusRepo.put({ stageId: 'stage-2', state: 'locked', viaPlacement: false });
    await logSet({ sessionId: 's1', drillId: 'd2-sidestep', nodeId: 'n2-sidestep', reps: 10, successes: 10, now: new Date('2026-10-31T20:00:00.000Z') });
    expect((await masteryRepo.get('n2-sidestep'))?.state).toBe('locked');
  });
});

describe('integrity self-repair for 1.x stage locks (2.0)', () => {
  it('runIntegrityChecks recomputes a lesson wrongly saved as locked in an open stage', async () => {
    const { stageStatusRepo, setsRepo } = await import('../../../src/data/repos');
    const { runIntegrityChecks } = await import('../../../src/services/diagnostics');
    await stageStatusRepo.put({ stageId: 'stage-1', state: 'open', viaPlacement: false });
    for (const day of ['2026-10-29', '2026-10-30', '2026-10-31']) {
      await setsRepo.put({ id: `set-${day}`, sessionId: 's1', drillId: 'd1-guard', nodeId: 'n1-guard', at: `${day}T20:00:00.000Z`, day, reps: 10, successes: 10 });
    }
    await masteryRepo.put({ nodeId: 'n1-guard', K: null, E: 1, A: null, score: 1, state: 'locked', placed: false, evidenceDays: ['2026-10-29', '2026-10-30', '2026-10-31'], updatedAt: '2026-10-31T20:00:00.000Z' });
    const result = await runIntegrityChecks();
    expect(result.checks.find((c) => c.id === 'mastery-stage-lock')?.repaired).toBe('1 recomputed');
    expect((await masteryRepo.get('n1-guard'))?.state).not.toBe('locked');
  });
});
