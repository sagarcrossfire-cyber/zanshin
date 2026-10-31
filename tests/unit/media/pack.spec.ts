// Amendment 01B — media pack import and export: verification per item, the
// report, replacement, and a lossless export → import round trip.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, mediaRepo, resetDbForTests } from '../../../src/data/repos';
import { hasMedia, mediaCount, resetMediaLibraryForTests } from '../../../src/services/mediaLibrary';
import {
  MEDIA_PACK_FORMAT,
  MediaImportError,
  addMediaFile,
  blobBytes,
  deleteAllMedia,
  deleteMedia,
  exportMediaPack,
  importMediaPack,
  sha256BytesHex,
} from '../../../src/services/mediaPack';

const NOW = () => '2026-10-30T10:00:00.000Z';

/** TextEncoder output wrapped as this realm's Uint8Array (jsdom hands back
 * a foreign-realm array that fflate would read as a folder). */
function utf8(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text));
}

function sha(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function fakeBytes(seed: number, length = 64): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length }, (_, i) => (seed * 31 + i * 7) % 256);
}

interface ItemSpec {
  file: string;
  kind: string;
  subjectKey: string;
  mime: string;
  data: Uint8Array<ArrayBuffer>;
  overrides?: Record<string, unknown>;
  omitFromZip?: boolean;
}

function makePack(specs: ItemSpec[], manifestOverrides: Record<string, unknown> = {}): Uint8Array {
  const files: Zippable = {};
  const items = specs.map((spec) => {
    if (!spec.omitFromZip) files[spec.file] = [spec.data, { level: 0 }];
    return {
      bytes: spec.data.byteLength,
      credit: 'Wavu Wiki',
      file: spec.file,
      kind: spec.kind,
      mime: spec.mime,
      sha256: sha(spec.data),
      sourcePage: 'https://wavu.wiki/t/File:Example',
      subjectKey: spec.subjectKey,
      ...spec.overrides,
    };
  });
  const manifest = { createdAt: NOW(), format: MEDIA_PACK_FORMAT, items, version: 1, ...manifestOverrides };
  return zipSync({ 'manifest.json': utf8(JSON.stringify(manifest)), ...files });
}

const ICON: ItemSpec = { data: fakeBytes(1), file: 'icons/JinT8.png', kind: 'character-icon', mime: 'image/png', overrides: { height: 88, width: 72 }, subjectKey: 'character:Jin' };
const CLIP: ItemSpec = { data: fakeBytes(2, 256), file: 'clips/yoshimitsu-1,2.mp4', kind: 'move-clip', mime: 'video/mp4', subjectKey: 'move:Yoshimitsu-1,2' };
const PORTRAIT: ItemSpec = { data: fakeBytes(3), file: 'portraits/Yoshimitsu_portrait.png', kind: 'character-portrait', mime: 'image/png', subjectKey: 'character:Yoshimitsu' };

beforeEach(async () => {
  await resetDbForTests();
  resetMediaLibraryForTests();
});

describe('sha256BytesHex', () => {
  it('matches Node for a subarray view', async () => {
    const whole = fakeBytes(9, 100);
    const view = whole.subarray(10, 60);
    expect(await sha256BytesHex(view)).toBe(sha(view));
  });
});

describe('importMediaPack', () => {
  it('imports every verified item, reports progress and updates the index', async () => {
    const progress: Array<[number, number]> = [];
    const report = await importMediaPack(makePack([ICON, CLIP, PORTRAIT]), {
      makeVariants: false,
      nowIso: NOW,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(report).toMatchObject({ failed: [], imported: 3, replaced: 0, total: 3 });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(hasMedia('move-clip', 'move:Yoshimitsu-1,2')).toBe(true);
    expect(mediaCount('character-icon')).toBe(1);
    const icon = await mediaRepo.find('character-icon', 'character:Jin');
    expect(icon).toMatchObject({ credit: 'Wavu Wiki', height: 88, origin: 'pack', sourcePage: 'https://wavu.wiki/t/File:Example', width: 72 });
    const clip = await mediaRepo.find('move-clip', 'move:Yoshimitsu-1,2');
    expect([...(await mediaRepo.blob(clip?.blobKey ?? '')) ?? []]).toEqual([...CLIP.data]);
  });

  it('skips and reports items that fail verification, storing the rest', async () => {
    const tampered: ItemSpec = { ...ICON, file: 'icons/KazuyaT8.png', overrides: { sha256: 'b'.repeat(64) }, subjectKey: 'character:Kazuya' };
    const missing: ItemSpec = { ...ICON, file: 'icons/missing.png', omitFromZip: true, subjectKey: 'character:Lili' };
    const wrongSize: ItemSpec = { ...ICON, file: 'icons/size.png', overrides: { bytes: 5 }, subjectKey: 'character:Lars' };
    const wrongKind: ItemSpec = { ...CLIP, file: 'clips/x.mp4', subjectKey: 'character:Paul' };
    const wrongMime: ItemSpec = { ...CLIP, file: 'clips/y.gif', mime: 'image/gif', subjectKey: 'move:Paul-1' };
    const tooBig: ItemSpec = { ...CLIP, file: 'clips/z.mp4', overrides: { bytes: 400 * 1024 * 1024 }, subjectKey: 'move:Paul-2' };
    const report = await importMediaPack(makePack([tampered, missing, wrongSize, wrongKind, wrongMime, tooBig, CLIP]), { makeVariants: false, nowIso: NOW });
    expect(report.imported).toBe(1);
    expect(report.failed.map((f) => f.reason)).toEqual([
      'SHA-256 does not match the manifest',
      'file listed in the manifest is missing from the zip',
      'size is 64 bytes, manifest says 5',
      'move-clip cannot belong to character:Paul',
      'image/gif is not allowed for move-clip',
      'file is larger than 300 MB',
    ]);
    expect(await mediaRepo.find('character-icon', 'character:Kazuya')).toBeUndefined();
  });

  it('replaces an item imported earlier and drops its old bytes', async () => {
    await importMediaPack(makePack([CLIP]), { makeVariants: false, nowIso: NOW });
    const newer: ItemSpec = { ...CLIP, data: fakeBytes(7, 300) };
    const report = await importMediaPack(makePack([newer]), { makeVariants: false, nowIso: () => '2026-10-31T10:00:00.000Z' });
    expect(report).toMatchObject({ imported: 1, replaced: 1 });
    expect(await db.mediaBlobs.count()).toBe(1);
    const clip = await mediaRepo.find('move-clip', 'move:Yoshimitsu-1,2');
    expect(clip?.bytes).toBe(300);
  });

  it('accepts unknown manifest fields and null optional fields (forward compatible)', async () => {
    const item: ItemSpec = { ...ICON, overrides: { focalPoint: { x: 0.5, y: 0.2 }, height: null, sourcePage: null, width: null } };
    const report = await importMediaPack(makePack([item], { generator: 'make_zanshin_media_pack.py', misses: [] }), { makeVariants: false, nowIso: NOW });
    expect(report.imported).toBe(1);
    const icon = await mediaRepo.find('character-icon', 'character:Jin');
    expect(icon?.sourcePage).toBeUndefined();
  });

  it('rejects files that are not media packs, changing nothing', async () => {
    await expect(importMediaPack(utf8('not a zip'))).rejects.toBeInstanceOf(MediaImportError);
    await expect(importMediaPack(new TextEncoder().encode('also not a zip'))).rejects.toBeInstanceOf(MediaImportError);
    await expect(importMediaPack(zipSync({ 'readme.txt': utf8('hi') }))).rejects.toThrow(/no manifest\.json/);
    await expect(importMediaPack(zipSync({ 'manifest.json': utf8('{oops') }))).rejects.toThrow(/not valid JSON/);
    await expect(importMediaPack(makePack([ICON], { format: 'something-else' }))).rejects.toThrow(/does not match the media pack format/);
    await expect(importMediaPack(makePack([ICON], { version: 2 }))).rejects.toThrow(/version/);
    expect(await mediaRepo.all()).toEqual([]);
  });

  it('reads a Blob as well as bytes', async () => {
    const pack = makePack([ICON]);
    const copy = new Uint8Array(pack.byteLength);
    copy.set(pack);
    const report = await importMediaPack(new Blob([copy.buffer]), { makeVariants: false, nowIso: NOW });
    expect(report.imported).toBe(1);
  });
});

describe('addMediaFile', () => {
  it('adds one picked file for a subject and records it as imported by Sagar', async () => {
    const data = fakeBytes(4);
    const result = await addMediaFile(new Blob([data]), 'rank-badge', 'rank:Tekken King', 'image/png', { dimensions: { height: 48, width: 48 }, makeVariants: false, nowIso: NOW });
    expect(result).toEqual({ id: 'rank-badge|rank:Tekken King', replaced: false });
    expect(await mediaRepo.find('rank-badge', 'rank:Tekken King')).toMatchObject({ credit: 'Imported by Sagar', origin: 'file', width: 48 });
    expect(hasMedia('rank-badge', 'rank:Tekken King')).toBe(true);
  });

  it('refuses a mismatched kind, subject or type', async () => {
    const blob = new Blob([fakeBytes(5)]);
    await expect(addMediaFile(blob, 'move-clip', 'character:Jin', 'video/mp4')).rejects.toThrow(/cannot belong/);
    await expect(addMediaFile(blob, 'move-clip', 'move:Jin-1', 'image/png')).rejects.toThrow(/MP4, WebM or MOV/);
    await expect(addMediaFile(blob, 'character-icon', 'character:Jin', 'video/mp4')).rejects.toThrow(/PNG, JPEG/);
  });
});

describe('exportMediaPack', () => {
  it('round-trips: what it exports imports back unchanged', async () => {
    await importMediaPack(makePack([ICON, CLIP, PORTRAIT]), { makeVariants: false, nowIso: NOW });
    const exported = await exportMediaPack('2026-10-30T12:34:56.000Z');
    expect(exported.count).toBe(3);
    expect(exported.fileName).toBe('zanshin-media-20261030-1234.zip');

    const zip = await blobBytes(exported.blob);
    const entries = unzipSync(zip);
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json'])) as { format: string; items: Array<{ file: string }> };
    expect(manifest.format).toBe(MEDIA_PACK_FORMAT);
    // Oldest import first; items imported together keep id order.
    expect(manifest.items.map((i) => i.file)).toEqual([
      'media/character-icon/0001-jin.png',
      'media/character-portrait/0002-yoshimitsu.png',
      'media/move-clip/0003-yoshimitsu-1-2.mp4',
    ]);

    await deleteAllMedia();
    expect(mediaCount()).toBe(0);
    const report = await importMediaPack(zip, { makeVariants: false, nowIso: NOW });
    expect(report).toMatchObject({ failed: [], imported: 3 });
    const clip = await mediaRepo.find('move-clip', 'move:Yoshimitsu-1,2');
    expect([...(await mediaRepo.blob(clip?.blobKey ?? '')) ?? []]).toEqual([...CLIP.data]);
    expect((await mediaRepo.find('character-icon', 'character:Jin'))?.sourcePage).toBe('https://wavu.wiki/t/File:Example');
  });

  it('exports an empty pack when nothing is stored', async () => {
    const exported = await exportMediaPack(NOW());
    expect(exported.count).toBe(0);
  });
});

describe('deleting', () => {
  it('deletes one item or everything, keeping the index in step', async () => {
    await importMediaPack(makePack([ICON, CLIP]), { makeVariants: false, nowIso: NOW });
    await deleteMedia('move-clip|move:Yoshimitsu-1,2');
    expect(hasMedia('move-clip', 'move:Yoshimitsu-1,2')).toBe(false);
    expect(mediaCount()).toBe(1);
    await deleteAllMedia();
    expect(mediaCount()).toBe(0);
    expect(await db.mediaBlobs.count()).toBe(0);
  });
});
