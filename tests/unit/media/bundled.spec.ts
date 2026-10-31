// Release 1.2.0 — bundled media: the app reads /media/manifest.json from its
// own origin and stores only what the device lacks; it stays quiet when the
// site has no media, when offline, in Safe Mode, or when switched off.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, mediaRepo, metaRepo, resetDbForTests } from '../../../src/data/repos';
import {
  BUNDLED_MANIFEST_URL,
  BUNDLED_META_KEY,
  bundledMediaRecord,
  resetBundledMediaForTests,
  seedBundledMedia,
} from '../../../src/services/bundledMedia';
import { hasMedia, mediaCount, resetMediaLibraryForTests } from '../../../src/services/mediaLibrary';

const NOW = () => '2026-10-31T12:00:00.000Z';

function bytes(seed: number, length = 32): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (seed * 17 + i * 3) % 256);
}

interface SiteItem { kind: string; subjectKey: string; mime: string; data: Uint8Array; sha?: string }

function site(items: SiteItem[], extra: Record<string, unknown> = {}) {
  const files = new Map<string, Uint8Array>();
  const manifestItems = items.map((item, i) => {
    const sha = createHash('sha256').update(item.data).digest('hex');
    const file = `media/${item.kind}/${sha.slice(0, 16)}-${i}.bin`;
    files.set(`/${file}`, item.data);
    return { bytes: item.data.byteLength, file, kind: item.kind, mime: item.mime, sha256: item.sha ?? sha, subjectKey: item.subjectKey };
  });
  const manifest = { createdAt: '2026-10-30T00:00:00Z', format: 'zanshin-media-pack', items: manifestItems, packId: 'sha256-test', version: 1, ...extra };
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url === BUNDLED_MANIFEST_URL) return new Response(JSON.stringify(manifest), { status: 200 });
    const data = files.get(url);
    if (!data) return new Response('', { status: 404 });
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Response(copy.buffer as ArrayBuffer, { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher, manifest };
}

const ICON: SiteItem = { data: bytes(1), kind: 'character-icon', mime: 'image/png', subjectKey: 'character:Jin' };
const CLIP: SiteItem = { data: bytes(2, 128), kind: 'move-clip', mime: 'video/mp4', subjectKey: 'move:Yoshimitsu-1,2' };
const BAD: SiteItem = { data: bytes(3), kind: 'move-clip', mime: 'video/mp4', sha: 'f'.repeat(64), subjectKey: 'move:Yoshimitsu-b+1+4' };

beforeEach(async () => {
  await resetDbForTests();
  resetMediaLibraryForTests();
  resetBundledMediaForTests();
  window.localStorage.removeItem('zanshin:safe-mode');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('seedBundledMedia', () => {
  it('stores what the site serves and records the result', async () => {
    const { fetcher, calls } = site([ICON, CLIP, BAD]);
    const result = await seedBundledMedia({ fetcher, makeVariants: false, nowIso: NOW });
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.report).toMatchObject({ failed: [{ reason: 'SHA-256 does not match the manifest' }], imported: 2, total: 3, unchanged: 0 });
    expect(result.record).toMatchObject({ failed: 1, imported: 2, packId: 'sha256-test', seededAt: NOW(), total: 3 });
    expect(hasMedia('character-icon', 'character:Jin')).toBe(true);
    expect(hasMedia('move-clip', 'move:Yoshimitsu-1,2')).toBe(true);
    expect((await mediaRepo.find('move-clip', 'move:Yoshimitsu-1,2'))?.origin).toBe('site');
    expect(await bundledMediaRecord()).toMatchObject({ packId: 'sha256-test' });
    expect(calls[0]).toBe(BUNDLED_MANIFEST_URL);
    expect(calls).toHaveLength(4);
  });

  it('downloads only items the device lacks on the next check', async () => {
    const { fetcher } = site([ICON, CLIP]);
    await seedBundledMedia({ fetcher, makeVariants: false, nowIso: NOW });
    const changedClip: SiteItem = { ...CLIP, data: bytes(9, 64) };
    const second = site([ICON, changedClip]);
    const result = await seedBundledMedia({ fetcher: second.fetcher, force: true, makeVariants: false, nowIso: () => '2026-10-31T13:00:00.000Z' });
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.report).toMatchObject({ imported: 1, replaced: 1, unchanged: 1 });
    expect(second.calls).toHaveLength(2);
    expect((await mediaRepo.find('move-clip', 'move:Yoshimitsu-1,2'))?.bytes).toBe(64);
    expect(await db.mediaBlobs.count()).toBe(2);
  });

  it('is quiet when the site has no media', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await seedBundledMedia({ fetcher, nowIso: NOW })).toEqual({ status: 'none' });
    expect(mediaCount()).toBe(0);
    expect(await metaRepo.get(BUNDLED_META_KEY)).toBeUndefined();
  });

  it('checks at most once per interval unless forced', async () => {
    const first = site([ICON]);
    await seedBundledMedia({ fetcher: first.fetcher, makeVariants: false, nowIso: NOW });
    const second = site([ICON]);
    expect(await seedBundledMedia({ fetcher: second.fetcher, nowIso: () => '2026-10-31T13:00:00.000Z' })).toEqual({ reason: 'recent', status: 'skipped' });
    expect(second.calls).toHaveLength(0);
    expect((await seedBundledMedia({ fetcher: second.fetcher, nowIso: () => '2026-10-31T19:00:00.000Z' })).status).toBe('done');
    expect((await seedBundledMedia({ fetcher: second.fetcher, force: true, nowIso: () => '2026-10-31T19:01:00.000Z' })).status).toBe('done');
  });

  it('does nothing when disabled, offline or in Safe Mode', async () => {
    const { fetcher, calls } = site([ICON]);
    expect(await seedBundledMedia({ enabled: false, fetcher, nowIso: NOW })).toEqual({ reason: 'disabled', status: 'skipped' });
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await seedBundledMedia({ fetcher, nowIso: NOW })).toEqual({ reason: 'offline', status: 'skipped' });
    onLine.mockRestore();
    window.localStorage.setItem('zanshin:safe-mode', '1');
    expect(await seedBundledMedia({ fetcher, nowIso: NOW })).toEqual({ reason: 'safe-mode', status: 'skipped' });
    expect(calls).toHaveLength(0);
  });

  it('reports an unusable manifest or a failing site without changing anything', async () => {
    const broken = vi.fn(async () => new Response('{nope', { status: 200 })) as unknown as typeof fetch;
    const result = await seedBundledMedia({ fetcher: broken, nowIso: NOW });
    expect(result.status).toBe('error');
    const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const result2 = await seedBundledMedia({ fetcher: down, force: true, nowIso: NOW });
    expect(result2).toMatchObject({ message: expect.stringContaining('503') as string, status: 'error' });
    const failing = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    expect((await seedBundledMedia({ fetcher: failing, force: true, nowIso: NOW })).status).toBe('error');
    expect(mediaCount()).toBe(0);
    const errors = await db.table('errors').toArray();
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps going when one file is missing from the site', async () => {
    const { fetcher, manifest } = site([ICON, CLIP]);
    const missing = { ...manifest, items: [...manifest.items, { bytes: 5, file: 'media/move-clip/none.mp4', kind: 'move-clip', mime: 'video/mp4', sha256: 'a'.repeat(64), subjectKey: 'move:Yoshimitsu-d+1' }] };
    const withMissing = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === BUNDLED_MANIFEST_URL) return new Response(JSON.stringify(missing), { status: 200 });
      return (fetcher as unknown as (i: RequestInfo | URL) => Promise<Response>)(input);
    }) as unknown as typeof fetch;
    const result = await seedBundledMedia({ fetcher: withMissing, makeVariants: false, nowIso: NOW });
    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.report.imported).toBe(2);
    expect(result.report.failed).toEqual([{ file: 'media/move-clip/none.mp4', reason: 'file listed in the manifest is missing', subjectKey: 'move:Yoshimitsu-d+1' }]);
  });
});
