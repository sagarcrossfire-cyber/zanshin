// 2.0 M3 (card m3-sync-storage) — applyRemoteChanges acceptance tests: writes without outbox
// rows, LWW + tombstones honoured, idempotent replay.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
const hlcModule = fakeAvailable ? await import('../../../src/domain/sync/hlc') : null;

describe.skipIf(!fakeAvailable)('applyRemoteChanges', () => {
  beforeEach(async () => {
    if (dbModule === null) return;
    await dbModule.resetDbForTests();
  });
  afterEach(async () => {
    if (dbModule === null) return;
    await dbModule.resetDbForTests();
  });

  it('writes a remote put with no outbox growth', async () => {
    if (repos === null || dbModule === null || hlcModule === null) return;
    const hlc1 = hlcModule.formatHlc(1000, 0, 'device-b');
    await repos.applyRemoteChanges([
      { table: 'sets', id: 's1', hlc: hlc1, op: 'put', value: {
        id: 's1', drillId: 'd1', nodeId: 'n1', at: '2026-10-29T10:00:00.000Z', day: '2026-10-29',
        reps: 10, successes: 7,
      } },
    ]);
    expect(await repos.setsRepo.get('s1')).toMatchObject({ id: 's1', reps: 10 });
    expect(await dbModule.db.syncOutbox.count()).toBe(0);
    const meta = await dbModule.db.syncMeta.get('sets:s1');
    expect(meta).toMatchObject({ hlc: hlc1 });
  });

  it('honours LWW: an older remote put for an already-newer record is skipped', async () => {
    if (repos === null || dbModule === null || hlcModule === null) return;
    const older = hlcModule.formatHlc(1000, 0, 'device-b');
    const newer = hlcModule.formatHlc(2000, 0, 'device-b');
    await repos.applyRemoteChanges([
      { table: 'profile', id: 'me', hlc: newer, op: 'put', value: { id: 'me', displayName: 'New', platform: 'ps5', controller: 'DualSense', glyphMode: 'playstation', targetRank: 'Tekken King', weeklyMinutes: 300, sessionMinutes: 30, preferredDays: [], dayBoundary: '04:00', timezone: 'America/Chicago', createdAt: '2026-10-29T05:52:00Z' } },
    ]);
    await repos.applyRemoteChanges([
      { table: 'profile', id: 'me', hlc: older, op: 'put', value: { id: 'me', displayName: 'Old', platform: 'ps5', controller: 'DualSense', glyphMode: 'playstation', targetRank: 'Tekken King', weeklyMinutes: 300, sessionMinutes: 30, preferredDays: [], dayBoundary: '04:00', timezone: 'America/Chicago', createdAt: '2026-10-29T05:52:00Z' } },
    ]);
    expect(await repos.profileRepo.get()).toMatchObject({ displayName: 'New' });
  });

  it('honours tombstones: a delete beats an older incoming put', async () => {
    if (repos === null || dbModule === null || hlcModule === null) return;
    const putHlc = hlcModule.formatHlc(1000, 0, 'device-b');
    const delHlc = hlcModule.formatHlc(2000, 0, 'device-b');
    await repos.applyRemoteChanges([
      { table: 'cards', id: 'c1', hlc: delHlc, op: 'delete' },
    ]);
    await repos.applyRemoteChanges([
      { table: 'cards', id: 'c1', hlc: putHlc, op: 'put', value: {
        id: 'c1', deck: 'Punish ladder', front: 'f', back: 'b', refs: [], createdAt: '2026-10-29T05:52:00Z',
      } },
    ]);
    expect(await repos.cardsRepo.get('c1')).toBeUndefined();
    const meta = await dbModule.db.syncMeta.get('cards:c1');
    expect(meta).toMatchObject({ deleted: true });
  });

  it('is idempotent: replaying the exact same change twice has no further effect', async () => {
    if (repos === null || dbModule === null || hlcModule === null) return;
    const hlc1 = hlcModule.formatHlc(1000, 0, 'device-b');
    const change = {
      table: 'cards' as const, id: 'c1', hlc: hlc1, op: 'put' as const, value: {
        id: 'c1', deck: 'Punish ladder', front: 'f', back: 'b', refs: [], createdAt: '2026-10-29T05:52:00Z',
      },
    };
    await repos.applyRemoteChanges([change]);
    await repos.applyRemoteChanges([change]);
    expect(await repos.cardsRepo.get('c1')).toMatchObject({ id: 'c1' });
    const meta = await dbModule.db.syncMeta.get('cards:c1');
    expect(meta).toMatchObject({ hlc: hlc1 });
  });

  it('a no-op batch (empty array) does nothing', async () => {
    if (repos === null) return;
    await expect(repos.applyRemoteChanges([])).resolves.toBeUndefined();
  });
});
