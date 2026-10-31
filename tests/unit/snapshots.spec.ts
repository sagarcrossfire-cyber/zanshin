// P10 — Snapshots (§6.6/§14.3): take/read round-trip, gzip + uncompressed
// fallback, prune policy (7 daily / 5 event), daily-once, restore with a
// pre-restore snapshot. Also the v1→v2 Dexie migration (reviews.at index).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../../src/data/bootstrap';
import { V1_STORES, V2_STORES } from '../../src/data/db';
import { errorsRepo, metaRepo, profileRepo, resetDbForTests, snapshotsRepo } from '../../src/data/repos';
import {
  ensureDailySnapshot,
  pruneSnapshots,
  readSnapshot,
  restoreSnapshot,
  snapshotPreview,
  takeSnapshot,
} from '../../src/services/snapshots';
import { canonicalJson, sha256Hex } from '../../src/services/backup';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

const at = (minute: number): string => `2026-10-29T10:${String(minute).padStart(2, '0')}:00.000Z`;

describe('take / read round-trip', () => {
  it('stores the full local state and reads it back with matching counts', async () => {
    await profileRepo.put({ ...defaultProfile('2026-10-29T10:00:00.000Z'), displayName: 'Sagar' });
    const { id, bytes, compressed } = await takeSnapshot('manual', at(5));
    expect(bytes).toBeGreaterThan(0);
    expect(typeof compressed).toBe('boolean');
    const payload = await readSnapshot(id);
    expect(payload.backup.tables.profile[0]).toMatchObject({ displayName: 'Sagar' });
    expect(payload.backup.includesPacks).toBe(true);
    expect(payload.backup.includesSecrets).toBe(true);
    const counts = await snapshotPreview(id);
    expect(counts['profile']).toBe(1);
    expect(counts['settings']).toBe(0);
    const stored = await snapshotsRepo.get(id);
    // stored.sha256 covers the payload text; backup.sha256 covers the tables.
    expect(stored?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.sha256).toBe(await sha256Hex(JSON.stringify(payload)));
    expect(stored?.bytes).toBe(stored?.data.length);
  });

  it('stores uncompressed and logs when CompressionStream is unavailable', async () => {
    const realCompression = globalThis.CompressionStream;
    const realDecompression = globalThis.DecompressionStream;
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      await profileRepo.put(defaultProfile('2026-10-29T10:00:00.000Z'));
      const { compressed } = await takeSnapshot('manual', at(6));
      expect(compressed).toBe(false);
      const errors = await errorsRepo.all();
      expect(errors.some((e) => e.where === 'snapshots.takeSnapshot')).toBe(true);
      const snaps = await snapshotsRepo.all();
      expect(snaps).toHaveLength(1);
      const payload = await readSnapshot(snaps[0]?.id ?? '');
      expect(payload.backup.tables.profile).toHaveLength(1);
    } finally {
      vi.stubGlobal('CompressionStream', realCompression);
      vi.stubGlobal('DecompressionStream', realDecompression);
      vi.unstubAllGlobals();
    }
  });
});

describe('prune policy', () => {
  it('keeps the newest 7 daily and 5 event snapshots', async () => {
    for (let i = 0; i < 9; i += 1) {
      await takeSnapshot('daily', at(i));
    }
    for (let i = 0; i < 7; i += 1) {
      await takeSnapshot('manual', at(20 + i));
    }
    await pruneSnapshots();
    const all = await snapshotsRepo.all();
    const daily = all.filter((s) => s.reason === 'daily');
    const events = all.filter((s) => s.reason === 'manual');
    expect(daily).toHaveLength(7);
    expect(events).toHaveLength(5);
    // The oldest daily (minute 00) and oldest events (minutes 20-21) are gone.
    expect(daily.some((s) => s.at === at(0))).toBe(false);
    expect(daily.some((s) => s.at === at(8))).toBe(true);
    expect(events.some((s) => s.at === at(20))).toBe(false);
    expect(events.some((s) => s.at === at(26))).toBe(true);
  });
});

describe('daily snapshot', () => {
  it('takes one snapshot per practice day and no more', async () => {
    expect(await ensureDailySnapshot('2026-10-29', at(5))).toBe(true);
    expect(await ensureDailySnapshot('2026-10-29', at(6))).toBe(false);
    expect(await ensureDailySnapshot('2026-10-30', at(7))).toBe(true);
    expect((await snapshotsRepo.all()).filter((s) => s.reason === 'daily')).toHaveLength(2);
    expect((await metaRepo.get('snapshots:lastDaily'))?.value).toBe('2026-10-30');
  });
});

describe('restore', () => {
  it('restores the exact prior state and snapshots the current state first', async () => {
    await profileRepo.put({ ...defaultProfile('2026-10-29T10:00:00.000Z'), displayName: 'Before' });
    const { id } = await takeSnapshot('manual', at(5));
    const beforeJson = canonicalJson((await readSnapshot(id)).backup.tables);
    await profileRepo.put({ ...defaultProfile('2026-10-29T10:00:00.000Z'), displayName: 'After' });
    const counts = await restoreSnapshot(id, at(9));
    expect(counts['profile']).toBe(1);
    const restored = await profileRepo.get();
    expect(restored?.displayName).toBe('Before');
    // A pre-restore manual snapshot captured the 'After' state.
    const snaps = await snapshotsRepo.all();
    expect(snaps.some((s) => s.reason === 'manual' && s.at === at(9))).toBe(true);
    const preRestore = snaps.find((s) => s.at === at(9));
    const prePayload = await readSnapshot(preRestore?.id ?? '');
    expect(prePayload.backup.tables.profile[0]).toMatchObject({ displayName: 'After' });
    expect(canonicalJson((await readSnapshot(id)).backup.tables)).toBe(beforeJson);
  });
});

describe('v1 → v2 migration (reviews.at index)', () => {
  it('preserves v1 rows and serves orderBy(at) under the v2 schema', async () => {
    const name = 'zanshin-mig-test';
    await Dexie.delete(name);
    const v1 = new Dexie(name);
    v1.version(1).stores(V1_STORES);
    await v1.open();
    await v1.table('reviews').put({
      id: 'r1', matchSetId: 'm1', at: '2026-10-29T10:00:00.000Z',
      notes: 'v1 row', timestamp: 0, side: 'p1', won: true,
    });
    await v1.close();
    const v2 = new Dexie(name);
    v2.version(1).stores(V1_STORES);
    v2.version(2).stores(V2_STORES);
    await v2.open();
    const rows = await v2.table('reviews').orderBy('at').toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'r1', notes: 'v1 row' });
    await v2.close();
    await Dexie.delete(name);
  });
});
