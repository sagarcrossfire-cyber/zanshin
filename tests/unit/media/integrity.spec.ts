// Amendment 01B — startup integrity checks with a media library: they never
// load media bytes, quarantine an invalid media row, and repair rows and
// bytes that disagree.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, mediaRepo, resetDbForTests } from '../../../src/data/repos';
import { runIntegrityChecks } from '../../../src/services/diagnostics';
import { hasMedia, refreshMediaIndex, resetMediaLibraryForTests } from '../../../src/services/mediaLibrary';

const AT = '2026-10-30T10:00:00.000Z';

async function seedClip(moveId: string): Promise<string> {
  const id = `move-clip|move:${moveId}`;
  await mediaRepo.put(
    {
      blobKey: `${id}#1`, bytes: 3, id, importedAt: AT, kind: 'move-clip', mime: 'video/mp4',
      origin: 'pack', sha256: 'd'.repeat(64), subjectKey: `move:${moveId}`,
    },
    [{ data: new Uint8Array([1, 2, 3]), key: `${id}#1` }],
  );
  return id;
}

beforeEach(async () => {
  await resetDbForTests();
  resetMediaLibraryForTests();
});

describe('integrity checks with imported media', () => {
  it('counts media bytes without loading them', async () => {
    await seedClip('Yoshimitsu-1,2');
    const toArray = vi.spyOn(db.mediaBlobs, 'toArray');
    const report = await runIntegrityChecks();
    expect(toArray).not.toHaveBeenCalled();
    toArray.mockRestore();
    const records = report.checks.find((c) => c.id === 'records-validate');
    expect(records?.detail).toContain('media: 1');
    expect(records?.detail).toContain('mediaBlobs: 1');
    expect(report.checks.find((c) => c.id === 'media')).toMatchObject({ detail: 'Media library consistent.', passed: true });
    expect(report.repaired).toEqual([]);
  });

  it('removes a clip whose bytes are gone and tells Sagar how to restore it', async () => {
    const id = await seedClip('Yoshimitsu-1,2');
    await seedClip('Yoshimitsu-b+1+4');
    await refreshMediaIndex();
    await db.mediaBlobs.delete(`${id}#1`);
    await db.mediaBlobs.put({ data: new Uint8Array([9]), key: 'stray' });

    const report = await runIntegrityChecks();
    const media = report.checks.find((c) => c.id === 'media');
    expect(media?.repaired).toBe('2 fixed');
    expect(report.repaired.join(' ')).toMatch(/1 media item\(s\) whose bytes were missing removed; import the pack again/);
    expect(report.repaired.join(' ')).toMatch(/1 unused media file\(s\) deleted/);
    expect(await mediaRepo.get(id)).toBeUndefined();
    expect(hasMedia('move-clip', 'move:Yoshimitsu-1,2')).toBe(false);
    expect(hasMedia('move-clip', 'move:Yoshimitsu-b+1+4')).toBe(true);
  });

  it('quarantines an invalid media row, then deletes the bytes it left behind', async () => {
    const id = await seedClip('Yoshimitsu-1,2');
    await db.media.put({ ...(await mediaRepo.get(id))!, kind: 'hologram' as never });
    const report = await runIntegrityChecks();
    expect(report.repaired.join(' ')).toContain(`media/${id}`);
    expect(await db.media.count()).toBe(0);
    expect(await db.mediaBlobs.count()).toBe(0);
  });
});
