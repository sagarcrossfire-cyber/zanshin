// P11 — pre-migration snapshots (§14.2/§14.5, R3). A pending upgrade is
// snapshotted through a probe connection at the OLD schema version before
// the app connection opens and Dexie upgrades; the snapshot survives the
// upgrade and parses under the current snapshot schema.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { V1_STORES, V2_STORES, V3_STORES } from '../../src/data/db';
import { ensureMigratedSafely, storedDbVersion, type VersionStorage } from '../../src/data/migrate';
import { snapshotSchema } from '../../src/data/schemas';
import { resetDbForTests } from '../../src/data/repos';
import { gunzipBytes } from '../../src/services/snapshots';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

function memoryStorage(initial?: Record<string, string>): VersionStorage {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

const STORES = { 1: V1_STORES, 2: V2_STORES, 3: V3_STORES };
const DB_NAME = 'zanshin-mig-p11-test';

describe('ensureMigratedSafely', () => {
  it('records the current version on a fresh install without snapshotting', async () => {
    const storage = memoryStorage();
    const result = await ensureMigratedSafely({
      currentVersion: 3, dbName: DB_NAME, storage, storesByVersion: STORES,
    });
    expect(result.snapshotTaken).toBe(false);
    expect(storedDbVersion(storage)).toBe(3);
  });

  it('does nothing when the stored version already matches', async () => {
    const storage = memoryStorage({ 'zanshin:db-version': '3' });
    const result = await ensureMigratedSafely({
      currentVersion: 3, dbName: DB_NAME, storage, storesByVersion: STORES,
    });
    expect(result.snapshotTaken).toBe(false);
  });

  it('snapshots v1 rows through the probe, and the snapshot + rows survive the upgrade to v3 (R3)', async () => {
    await Dexie.delete(DB_NAME);
    const v1 = new Dexie(DB_NAME);
    v1.version(1).stores(V1_STORES);
    await v1.open();
    await v1.table('profile').put({
      id: 'profile', displayName: 'Sagar', currentRank: 'Fujin', targetRank: 'Tekken King',
      platform: 'ps5', glyphMode: 'playstation', controller: 'dualsense', weeklyMinutes: 300,
      minutesPerSession: 30, preferredDays: [1, 3, 5], dayBoundary: '04:00', onboardingStep: 6,
      tekkenId: null, createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z',
    });
    await v1.table('sets').put({
      id: 's1', sessionId: 'sess1', drillId: 'd1-punish-ladder', nodeId: 'n1',
      day: '2026-10-29', at: '2026-10-29T10:00:00.000Z', reps: 10, successes: 7,
    });
    await v1.close();

    const storage = memoryStorage({ 'zanshin:db-version': '1' });
    const result = await ensureMigratedSafely({
      currentVersion: 3, dbName: DB_NAME, storage, storesByVersion: STORES,
      atIso: '2026-10-29T11:00:00.000Z',
    });
    expect(result.snapshotTaken).toBe(true);
    expect(result.snapshotId).toBe('snap-1793271600000-pre-migration');
    expect(storedDbVersion(storage)).toBe(3);

    // Now open at v3: Dexie runs the upgrade; rows and snapshot survive.
    const v3 = new Dexie(DB_NAME);
    v3.version(1).stores(V1_STORES);
    v3.version(2).stores(V2_STORES);
    v3.version(3).stores(V3_STORES);
    await v3.open();
    const profiles = await v3.table('profile').toArray();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ displayName: 'Sagar' });
    const sets = await v3.table('sets').toArray();
    expect(sets).toHaveLength(1);
    const snaps = await v3.table('snapshots').toArray();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ reason: 'pre-migration' });
    expect(snapshotSchema.safeParse(snaps[0]).success).toBe(true);
    const compressed = (snaps[0].data as Uint8Array)[0] === 0x1f;
    const text = await gunzipBytes(snaps[0].data as Uint8Array, compressed);
    const payload = JSON.parse(text) as { backup: { tables: { profile: Array<Record<string, unknown>>; sets: unknown[] } } };
    expect(payload.backup.tables.profile[0]).toMatchObject({ displayName: 'Sagar' });
    expect(payload.backup.tables.sets).toHaveLength(1);
    await v3.close();
    await Dexie.delete(DB_NAME);
  });

  it('never blocks startup when the probe fails (R3 records it in Diagnostics)', async () => {
    const storage = memoryStorage({ 'zanshin:db-version': '1' });
    const result = await ensureMigratedSafely({
      currentVersion: 3, dbName: DB_NAME, storage, storesByVersion: {},
    });
    // No store definition for the stored version, so the probe cannot run;
    // the guard reports the failure instead of throwing.
    expect(result.snapshotTaken).toBe(false);
    expect(result.probeError).toMatch(/version 1/);
    expect(storedDbVersion(storage)).toBe(3);
  });
});
