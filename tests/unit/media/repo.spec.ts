// Amendment 01B — the media repository: rows and bytes written and removed
// together, validation, stats, and the byte-free consistency check.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { blobKeysOf, db, mediaAssetId, mediaRepo, resetDbForTests } from '../../../src/data/repos';
import type { MediaAsset, MediaBlob } from '../../../src/data/schemas';

const AT = '2026-10-30T10:00:00.000Z';
const SHA = 'a'.repeat(64);

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function iconRow(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    blobKey: 'character-icon|character:Jin#1',
    bytes: 3,
    id: mediaAssetId('character-icon', 'character:Jin'),
    importedAt: AT,
    kind: 'character-icon',
    mime: 'image/png',
    origin: 'pack',
    sha256: SHA,
    subjectKey: 'character:Jin',
    ...overrides,
  };
}

function portraitRow(): MediaAsset {
  return {
    blobKey: 'character-portrait|character:Jin#1',
    bytes: 4,
    id: mediaAssetId('character-portrait', 'character:Jin'),
    importedAt: AT,
    kind: 'character-portrait',
    mime: 'image/png',
    origin: 'pack',
    sha256: SHA,
    subjectKey: 'character:Jin',
    variants: [
      { blobKey: 'character-portrait|character:Jin#1@320', bytes: 2, mime: 'image/webp', width: 320 },
      { blobKey: 'character-portrait|character:Jin#1@640', bytes: 2, mime: 'image/webp', width: 640 },
    ],
    width: 1000,
  };
}

function blobsFor(row: MediaAsset): MediaBlob[] {
  return blobKeysOf(row).map((key, i) => ({ data: bytes(i, i + 1), key }));
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('mediaRepo', () => {
  it('stores a row with its bytes and reads both back', async () => {
    const row = iconRow();
    await mediaRepo.put(row, [{ data: bytes(1, 2, 3), key: row.blobKey }]);
    expect(await mediaRepo.find('character-icon', 'character:Jin')).toMatchObject({ subjectKey: 'character:Jin' });
    expect(await mediaRepo.get(row.id)).toBeDefined();
    expect([...(await mediaRepo.blob(row.blobKey)) ?? []]).toEqual([1, 2, 3]);
    expect(await mediaRepo.allBySubject('character:Jin')).toHaveLength(1);
  });

  it('refuses a row whose bytes are missing, or bytes no row references', async () => {
    const row = iconRow();
    await expect(mediaRepo.put(row, [])).rejects.toThrow(/missing blob/);
    await expect(mediaRepo.put(row, [{ data: bytes(1), key: row.blobKey }, { data: bytes(2), key: 'stray' }]))
      .rejects.toThrow(/not referenced/);
    expect(await mediaRepo.all()).toEqual([]);
  });

  it('refuses an invalid row', async () => {
    const row = iconRow({ sha256: 'nope' });
    await expect(mediaRepo.put(row, [{ data: bytes(1), key: row.blobKey }])).rejects.toThrow();
  });

  it('replacing a row deletes the old row\'s bytes in the same write', async () => {
    const first = iconRow();
    await mediaRepo.put(first, [{ data: bytes(1), key: first.blobKey }]);
    const second = iconRow({ blobKey: 'character-icon|character:Jin#2', bytes: 1 });
    await mediaRepo.put(second, [{ data: bytes(9), key: second.blobKey }]);
    expect(await mediaRepo.blob(first.blobKey)).toBeUndefined();
    expect([...(await mediaRepo.blob(second.blobKey)) ?? []]).toEqual([9]);
    expect(await db.mediaBlobs.count()).toBe(1);
  });

  it('removes a row with all its variants, and clears everything', async () => {
    const portrait = portraitRow();
    await mediaRepo.put(portrait, blobsFor(portrait));
    const icon = iconRow();
    await mediaRepo.put(icon, blobsFor(icon));
    expect(await db.mediaBlobs.count()).toBe(4);
    await mediaRepo.remove(portrait.id);
    expect(await db.mediaBlobs.count()).toBe(1);
    await mediaRepo.remove('missing-id');
    await mediaRepo.clear();
    expect(await mediaRepo.all()).toEqual([]);
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it('reports counts and stored bytes by kind (variants included)', async () => {
    const portrait = portraitRow();
    await mediaRepo.put(portrait, blobsFor(portrait));
    const icon = iconRow();
    await mediaRepo.put(icon, blobsFor(icon));
    const stats = await mediaRepo.stats();
    expect(stats.count).toBe(2);
    expect(stats.bytes).toBe(4 + 2 + 2 + 3);
    expect(stats.byKind['character-portrait']).toBe(1);
    expect(stats.byKind['character-icon']).toBe(1);
    expect(stats.byKind['move-clip']).toBe(0);
  });
});

describe('mediaRepo.checkConsistency', () => {
  it('finds nothing wrong in a consistent library', async () => {
    const portrait = portraitRow();
    await mediaRepo.put(portrait, blobsFor(portrait));
    expect(await mediaRepo.checkConsistency(true)).toEqual({ orphanBlobKeys: [], rowsRemoved: [], rowsTrimmed: [] });
  });

  it('reports without changing anything when repair is off', async () => {
    const portrait = portraitRow();
    await mediaRepo.put(portrait, blobsFor(portrait));
    await db.mediaBlobs.put({ data: bytes(7), key: 'orphan' });
    await db.mediaBlobs.delete('character-portrait|character:Jin#1@640');
    const report = await mediaRepo.checkConsistency(false);
    expect(report.orphanBlobKeys).toEqual(['orphan']);
    expect(report.rowsTrimmed).toEqual([portrait.id]);
    expect(await db.mediaBlobs.get('orphan')).toBeDefined();
    expect((await mediaRepo.get(portrait.id))?.variants).toHaveLength(2);
  });

  it('repairs: drops a missing variant, removes a row without its original, deletes stray bytes', async () => {
    const portrait = portraitRow();
    await mediaRepo.put(portrait, blobsFor(portrait));
    const icon = iconRow();
    await mediaRepo.put(icon, blobsFor(icon));
    await db.mediaBlobs.delete('character-portrait|character:Jin#1@640');
    await db.mediaBlobs.delete(icon.blobKey);
    await db.mediaBlobs.put({ data: bytes(7), key: 'orphan' });

    const report = await mediaRepo.checkConsistency(true);
    expect(report.rowsRemoved).toEqual([icon.id]);
    expect(report.rowsTrimmed).toEqual([portrait.id]);
    expect(report.orphanBlobKeys).toEqual(['orphan']);

    expect(await mediaRepo.get(icon.id)).toBeUndefined();
    const trimmed = await mediaRepo.get(portrait.id);
    expect(trimmed?.variants?.map((v) => v.width)).toEqual([320]);
    expect((await db.mediaBlobs.toCollection().primaryKeys()).sort()).toEqual([
      'character-portrait|character:Jin#1',
      'character-portrait|character:Jin#1@320',
    ]);
    expect(await mediaRepo.checkConsistency(true)).toEqual({ orphanBlobKeys: [], rowsRemoved: [], rowsTrimmed: [] });
  });

  it('removes the variants property entirely when every variant is gone', async () => {
    const portrait = portraitRow();
    await mediaRepo.put(portrait, blobsFor(portrait));
    await db.mediaBlobs.bulkDelete(['character-portrait|character:Jin#1@320', 'character-portrait|character:Jin#1@640']);
    await mediaRepo.checkConsistency(true);
    const row = await mediaRepo.get(portrait.id);
    expect(row?.variants).toBeUndefined();
  });
});
