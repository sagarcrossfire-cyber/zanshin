// 2.0 M3 (card m3-sync-storage) — schema v6 adds `syncOutbox` + `syncMeta`. Upgrading a v5
// database snapshots it first (R3), keeps every row, and starts both new tables empty.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION, V1_STORES, V2_STORES, V3_STORES, V4_STORES, V5_STORES, V6_STORES,
} from '../../../src/data/db';
import { ensureMigratedSafely, storedDbVersion, type VersionStorage } from '../../../src/data/migrate';

const DB_NAME = 'zanshin-mig-v6-test';

function memoryStorage(initial?: Record<string, string>): VersionStorage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

function openAt(version: number): Dexie {
  const database = new Dexie(DB_NAME);
  const stores = [V1_STORES, V2_STORES, V3_STORES, V4_STORES, V5_STORES, V6_STORES];
  for (let i = 0; i < version; i += 1) database.version(i + 1).stores(stores[i] as Record<string, string>);
  return database;
}

describe('schema v6 (sync outbox + sync meta)', () => {
  it('is the current schema and only adds syncOutbox + syncMeta', () => {
    expect(SCHEMA_VERSION).toBe(6);
    expect(V6_STORES).toMatchObject(V5_STORES);
    expect(Object.keys(V6_STORES).filter((k) => !(k in V5_STORES)).sort()).toEqual(['syncMeta', 'syncOutbox']);
  });

  it('snapshots a v5 database, then upgrades it with every row kept and both new tables empty', async () => {
    await Dexie.delete(DB_NAME);
    const v5 = openAt(5);
    await v5.open();
    await v5.table('sets').put({
      at: '2026-10-29T10:00:00.000Z', day: '2026-10-29', drillId: 'd1-punish-ladder', id: 's1',
      nodeId: 'n1', reps: 10, sessionId: 'sess1', successes: 7,
    });
    await v5.table('research').put({
      citations: [], createdAt: '2026-10-31T09:00:00.000Z', id: 'r1', kind: 'primer', model: 'perplexity/sonar',
      question: 'Yoshimitsu vs Jin', subjectKey: 'character:Jin', text: 'Their plan: pressure.',
    });
    v5.close();

    const storage = memoryStorage({ 'zanshin:db-version': '5' });
    const result = await ensureMigratedSafely({
      atIso: '2026-11-03T09:00:00.000Z',
      currentVersion: 6,
      dbName: DB_NAME,
      storage,
      storesByVersion: {
        1: V1_STORES, 2: V2_STORES, 3: V3_STORES, 4: V4_STORES, 5: V5_STORES, 6: V6_STORES,
      },
    });
    expect(result.snapshotTaken).toBe(true);
    expect(storedDbVersion(storage)).toBe(6);

    const v6 = openAt(6);
    await v6.open();
    expect(await v6.table('sets').count()).toBe(1);
    expect(await v6.table('research').count()).toBe(1);
    expect(await v6.table('snapshots').where('reason').equals('pre-migration').count()).toBe(1);
    expect(await v6.table('syncOutbox').count()).toBe(0);
    expect(await v6.table('syncMeta').count()).toBe(0);

    // Both new tables are usable after the upgrade.
    await v6.table('syncMeta').put({ key: 'clock', hlc: '0000000000001-0000-device-a' });
    await v6.table('syncOutbox').add({ table: 'sets', id: 's1', hlc: '0000000000001-0000-device-a', op: 'put', value: { id: 's1' } });
    expect(await v6.table('syncMeta').get('clock')).toMatchObject({ hlc: '0000000000001-0000-device-a' });
    expect(await v6.table('syncOutbox').where('table').equals('sets').count()).toBe(1);
    v6.close();
    await Dexie.delete(DB_NAME);
  });
});
