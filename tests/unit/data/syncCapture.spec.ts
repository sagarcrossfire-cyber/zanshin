// 2.0 M3 (card m3-sync-storage) — change capture acceptance tests, using fake-indexeddb.
// Guard: if fake-indexeddb cannot be imported at runtime, every test in this file is skipped
// instead of failing, matching tests/unit/data/repos.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
if (fakeAvailable) {
  const globals = globalThis as Record<string, unknown>;
  globals['indexedDB'] = fakeModule?.['indexedDB'];
  globals['IDBKeyRange'] = fakeModule?.['IDBKeyRange'];
}

const repos = fakeAvailable ? await import('../../../src/data/repos/index') : null;
const dbModule = fakeAvailable ? await import('../../../src/data/db') : null;

async function pair(deviceId = 'device-a'): Promise<void> {
  if (dbModule === null) return;
  await dbModule.db.syncMeta.put({ key: 'device', deviceId });
  await dbModule.db.syncMeta.put({ key: 'pairing', pairedAt: '2026-11-03T00:00:00.000Z' });
}

describe.skipIf(!fakeAvailable)('change capture', () => {
  beforeEach(async () => {
    if (dbModule === null) return;
    await dbModule.resetDbForTests();
  });
  afterEach(async () => {
    if (dbModule === null) return;
    await dbModule.resetDbForTests();
  });

  it('unpaired device: a synced-table write grows no outbox and no syncMeta row', async () => {
    if (repos === null || dbModule === null) return;
    await repos.setsRepo.put({
      id: 's1', drillId: 'd1', nodeId: 'n1', at: '2026-10-29T10:00:00.000Z', day: '2026-10-29',
      reps: 10, successes: 7,
    });
    expect(await dbModule.db.syncOutbox.count()).toBe(0);
    expect(await dbModule.db.syncMeta.count()).toBe(0);
  });

  it('paired device: one outbox row per write, in the same transaction as the record', async () => {
    if (repos === null || dbModule === null) return;
    await pair();
    await repos.setsRepo.put({
      id: 's1', drillId: 'd1', nodeId: 'n1', at: '2026-10-29T10:00:00.000Z', day: '2026-10-29',
      reps: 10, successes: 7,
    });
    const outbox = await dbModule.db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ table: 'sets', id: 's1', op: 'put' });
    const meta = await dbModule.db.syncMeta.get('sets:s1');
    expect(meta).toMatchObject({ hlc: outbox[0]?.hlc });
    const clock = await dbModule.db.syncMeta.get('clock');
    expect(clock).toMatchObject({ hlc: outbox[0]?.hlc });
  });

  it('a forced failure after the record write rolls back both the record and the outbox row', async () => {
    if (repos === null || dbModule === null) return;
    await pair();
    const spy = vi.spyOn(dbModule.db.syncOutbox, 'add').mockRejectedValueOnce(new Error('forced failure'));
    await expect(repos.setsRepo.put({
      id: 's1', drillId: 'd1', nodeId: 'n1', at: '2026-10-29T10:00:00.000Z', day: '2026-10-29',
      reps: 10, successes: 7,
    })).rejects.toThrow('forced failure');
    spy.mockRestore();
    expect(await repos.setsRepo.get('s1')).toBeUndefined();
    expect(await dbModule.db.syncOutbox.count()).toBe(0);
    // Only the 'device' + 'pairing' rows from pair() remain; the sets:s1 meta row never landed.
    expect(await dbModule.db.syncMeta.count()).toBe(2);
    expect(await dbModule.db.syncMeta.get('sets:s1')).toBeUndefined();
    expect(await dbModule.db.syncMeta.get('clock')).toBeUndefined();
  });

  it('settings outbox value has no aiApiKey', async () => {
    if (repos === null || dbModule === null) return;
    await pair();
    await repos.settingsRepo.put({
      id: 'settings', theme: 'dark', labAudioCues: true, labWakeLock: false, repsPerSet: 10,
      newCardsPerDay: 5, reviewsPerDay: 20, aiProvider: 'zanshin', aiRequestsPerHour: 10,
      aiApiKey: 'super-secret-value', snapshotsKeptDaily: 7, snapshotsKeptEvent: 7,
      backupReminderDays: 14, inAppImporterEnabled: true, matchImportEnabled: true,
      dataPatch: '1.0', dataSource: 'wavu', kpiTargets: {},
    });
    const outbox = await dbModule.db.syncOutbox.toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.value).toBeDefined();
    expect(JSON.stringify(outbox[0]?.value)).not.toMatch(/aiApiKey|super-secret-value/);
  });

  it('deletes write a tombstone in syncMeta and an outbox row with op delete', async () => {
    if (repos === null || dbModule === null) return;
    await pair();
    await repos.setsRepo.put({
      id: 's1', drillId: 'd1', nodeId: 'n1', at: '2026-10-29T10:00:00.000Z', day: '2026-10-29',
      reps: 10, successes: 7,
    });
    await repos.setsRepo.remove('s1');
    const meta = await dbModule.db.syncMeta.get('sets:s1');
    expect(meta).toMatchObject({ deleted: true });
    const outbox = await dbModule.db.syncOutbox.toArray();
    expect(outbox).toHaveLength(2);
    expect(outbox[1]).toMatchObject({ table: 'sets', id: 's1', op: 'delete' });
    expect('value' in (outbox[1] ?? {})).toBe(false);
  });

  it('mastery writes are never captured, even when paired', async () => {
    if (repos === null || dbModule === null) return;
    await pair();
    await repos.masteryRepo.put({
      nodeId: 'n1-punish', K: 0.8, E: 0.7, A: null, score: 72, state: 'practicing',
      placed: false, evidenceDays: ['2026-10-29'], updatedAt: '2026-10-29T05:52:00Z',
    });
    expect(await dbModule.db.syncOutbox.count()).toBe(0);
    // Only the 'device' + 'pairing' rows from pair(); masteryRepo.put added nothing.
    expect(await dbModule.db.syncMeta.count()).toBe(2);
  });

  it('matchSetsRepo.putMany captures one outbox row per set in a single transaction', async () => {
    if (repos === null || dbModule === null) return;
    await pair();
    const base = {
      at: '2026-10-29T10:00:00.000Z', day: '2026-10-29', mode: 'ranked' as const,
      opponentCharacter: 'Jin', games: 1, wins: 1,
      tallies: {
        missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0, spinEscaped: 0,
        spinPunished: 0, throwsBroken: 0, throwsMissed: 0, hitWhileMinus: 0, lowsBlocked: 0,
        lowsEaten: 0, heatConverted: 0, heatWasted: 0, okiConverted: 0,
      },
      beatBy: [], tags: [],
    };
    await repos.matchSetsRepo.putMany([
      { id: 'm1', ...base },
      { id: 'm2', ...base },
    ]);
    const outbox = await dbModule.db.syncOutbox.toArray();
    expect(outbox).toHaveLength(2);
    expect(outbox.map((row) => row.id).sort()).toEqual(['m1', 'm2']);
  });
});
