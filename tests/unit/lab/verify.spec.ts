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
