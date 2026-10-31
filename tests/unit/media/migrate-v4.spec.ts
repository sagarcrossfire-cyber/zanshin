// Amendment 01B — schema v4 adds `media` and `mediaBlobs`. Upgrading a v3
// database snapshots it first (R3), keeps every row, and starts the media
// tables empty.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, V1_STORES, V2_STORES, V3_STORES, V4_STORES } from '../../../src/data/db';
import { ensureMigratedSafely, storedDbVersion, type VersionStorage } from '../../../src/data/migrate';

const DB_NAME = 'zanshin-mig-v4-test';

function memoryStorage(initial?: Record<string, string>): VersionStorage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

describe('schema v4 (media library)', () => {
  it('only adds the two media stores', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
    expect(V4_STORES).toMatchObject(V3_STORES);
    expect(Object.keys(V4_STORES).filter((k) => !(k in V3_STORES)).sort()).toEqual(['media', 'mediaBlobs']);
  });

  it('snapshots a v3 database, then upgrades it with every row kept and empty media tables', async () => {
    await Dexie.delete(DB_NAME);
    const v3 = new Dexie(DB_NAME);
    v3.version(1).stores(V1_STORES);
    v3.version(2).stores(V2_STORES);
    v3.version(3).stores(V3_STORES);
    await v3.open();
    await v3.table('sets').put({
      at: '2026-10-29T10:00:00.000Z', day: '2026-10-29', drillId: 'd1-punish-ladder', id: 's1',
      nodeId: 'n1', reps: 10, sessionId: 'sess1', successes: 7,
    });
    v3.close();

    const storage = memoryStorage({ 'zanshin:db-version': '3' });
    const result = await ensureMigratedSafely({
      atIso: '2026-10-30T09:00:00.000Z',
      currentVersion: 4,
      dbName: DB_NAME,
      storage,
      storesByVersion: { 1: V1_STORES, 2: V2_STORES, 3: V3_STORES, 4: V4_STORES },
    });
    expect(result.snapshotTaken).toBe(true);
    expect(storedDbVersion(storage)).toBe(4);

    const v4 = new Dexie(DB_NAME);
    v4.version(1).stores(V1_STORES);
    v4.version(2).stores(V2_STORES);
    v4.version(3).stores(V3_STORES);
    v4.version(4).stores(V4_STORES);
    await v4.open();
    expect(await v4.table('sets').count()).toBe(1);
    expect(await v4.table('snapshots').where('reason').equals('pre-migration').count()).toBe(1);
    expect(await v4.table('media').count()).toBe(0);
    expect(await v4.table('mediaBlobs').count()).toBe(0);
    await v4.table('media').put({
      blobKey: 'k', bytes: 1, id: 'character-icon|character:Jin', importedAt: '2026-10-30T09:00:00.000Z',
      kind: 'character-icon', mime: 'image/png', origin: 'pack', sha256: 'a'.repeat(64), subjectKey: 'character:Jin',
    });
    expect(await v4.table('media').where('subjectKey').equals('character:Jin').count()).toBe(1);
    v4.close();
    await Dexie.delete(DB_NAME);
  });
});
