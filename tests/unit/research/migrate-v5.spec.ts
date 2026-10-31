// Release 1.3.0 — schema v5 adds `research`. Upgrading a v4 database
// snapshots it first (R3), keeps every row including media, and starts the
// research table empty.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, V1_STORES, V2_STORES, V3_STORES, V4_STORES, V5_STORES } from '../../../src/data/db';
import { ensureMigratedSafely, storedDbVersion, type VersionStorage } from '../../../src/data/migrate';

const DB_NAME = 'zanshin-mig-v5-test';

function memoryStorage(initial?: Record<string, string>): VersionStorage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

function openAt(version: number): Dexie {
  const database = new Dexie(DB_NAME);
  const stores = [V1_STORES, V2_STORES, V3_STORES, V4_STORES, V5_STORES];
  for (let i = 0; i < version; i += 1) database.version(i + 1).stores(stores[i] as Record<string, string>);
  return database;
}

describe('schema v5 (research notes)', () => {
  it('is the current schema and only adds the research store', () => {
    expect(SCHEMA_VERSION).toBe(5);
    expect(V5_STORES).toMatchObject(V4_STORES);
    expect(Object.keys(V5_STORES).filter((k) => !(k in V4_STORES))).toEqual(['research']);
  });

  it('snapshots a v4 database, then upgrades it with every row kept and an empty research table', async () => {
    await Dexie.delete(DB_NAME);
    const v4 = openAt(4);
    await v4.open();
    await v4.table('sets').put({
      at: '2026-10-29T10:00:00.000Z', day: '2026-10-29', drillId: 'd1-punish-ladder', id: 's1',
      nodeId: 'n1', reps: 10, sessionId: 'sess1', successes: 7,
    });
    await v4.table('media').put({
      blobKey: 'k', bytes: 1, id: 'character-icon|character:Jin', importedAt: '2026-10-30T09:00:00.000Z',
      kind: 'character-icon', mime: 'image/png', origin: 'site', sha256: 'a'.repeat(64), subjectKey: 'character:Jin',
    });
    await v4.table('mediaBlobs').put({ data: new Uint8Array([1]), key: 'k' });
    v4.close();

    const storage = memoryStorage({ 'zanshin:db-version': '4' });
    const result = await ensureMigratedSafely({
      atIso: '2026-10-31T09:00:00.000Z',
      currentVersion: 5,
      dbName: DB_NAME,
      storage,
      storesByVersion: { 1: V1_STORES, 2: V2_STORES, 3: V3_STORES, 4: V4_STORES, 5: V5_STORES },
    });
    expect(result.snapshotTaken).toBe(true);
    expect(storedDbVersion(storage)).toBe(5);

    const v5 = openAt(5);
    await v5.open();
    expect(await v5.table('sets').count()).toBe(1);
    expect(await v5.table('media').count()).toBe(1);
    expect(await v5.table('mediaBlobs').count()).toBe(1);
    expect(await v5.table('snapshots').where('reason').equals('pre-migration').count()).toBe(1);
    expect(await v5.table('research').count()).toBe(0);
    await v5.table('research').put({
      citations: [], createdAt: '2026-10-31T09:00:00.000Z', id: 'r1', kind: 'primer', model: 'perplexity/sonar',
      question: 'Yoshimitsu vs Jin', subjectKey: 'character:Jin', text: 'Their plan: pressure.',
    });
    expect(await v5.table('research').where('subjectKey').equals('character:Jin').count()).toBe(1);
    expect(await v5.table('research').where('kind').equals('primer').count()).toBe(1);
    v5.close();
    await Dexie.delete(DB_NAME);
  });
});
