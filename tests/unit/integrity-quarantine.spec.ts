// P11 — integrity quarantine (§14.2, R1). An invalid row in a user table is
// quarantined to the errors ring buffer with its original JSON, the row is
// removed, and the app loads and explains instead of blanking. Valid rows
// are untouched.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/data/db';
import { errorsRepo, resetDbForTests, setsRepo } from '../../src/data/repos';
import { runIntegrityChecks } from '../../src/services/diagnostics';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

describe('quarantineInvalidRows (R1)', () => {
  it('quarantines an invalid sets row to errors with its original JSON and removes it', async () => {
    const valid = await setsRepo.put({
      id: 'good-1', sessionId: 'sess1', drillId: 'd1-punish-ladder', nodeId: 'n1',
      day: '2026-10-29', at: '2026-10-29T10:00:00.000Z', reps: 10, successes: 7,
    });
    expect(valid.id).toBe('good-1');
    // Bypass the repo's Zod validation with a raw Dexie write: a corrupt row.
    await db.sets.put({
      id: 'bad-1', sessionId: 'sess1', drillId: 'd1-punish-ladder', nodeId: 'n1',
      day: '2026-10-29', at: 'not-a-date-but-a-string', reps: -3, successes: 99,
    } as never);
    expect(await db.sets.count()).toBe(2);

    const report = await runIntegrityChecks();
    const check = report.checks.find((c) => c.id === 'records-validate');
    expect(check?.passed).toBe(true);
    expect(report.repaired.join(' ')).toContain('1 invalid row(s) quarantined');

    expect(await db.sets.count()).toBe(1);
    expect(await setsRepo.get('good-1')).toBeDefined();
    expect(await setsRepo.get('bad-1')).toBeUndefined();
    const errors = await errorsRepo.all();
    const quarantine = errors.find((e) => e.where === 'diagnostics.quarantineInvalidRows');
    expect(quarantine).toBeDefined();
    expect(quarantine?.message).toContain('sets/bad-1');
    expect(quarantine?.message).toContain('bad-1');
  });

  it('leaves a valid database untouched and reports all rows valid', async () => {
    await setsRepo.put({
      id: 'good-1', sessionId: 'sess1', drillId: 'd1-punish-ladder', nodeId: 'n1',
      day: '2026-10-29', at: '2026-10-29T10:00:00.000Z', reps: 10, successes: 7,
    });
    const report = await runIntegrityChecks();
    expect(report.repaired).toEqual([]);
    expect(await setsRepo.get('good-1')).toBeDefined();
    const errors = await errorsRepo.all();
    expect(errors.filter((e) => e.where === 'diagnostics.quarantineInvalidRows')).toHaveLength(0);
  });
});
