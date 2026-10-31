// Release 1.2.0 — bundled media. The deploy pipeline builds a media pack
// from Wavu Wiki and publishes it with the site under /media/ (manifest.json
// plus content-addressed files). On each device the app reads that manifest
// from its own origin and stores any image or clip it does not already hold,
// so every device gets the art without a manual import and keeps it offline.
//
// Rules: same origin only, never another site; only when online, not in
// Safe Mode, and only when Sagar has not switched it off in Settings. The
// manifest is small and is re-checked at most every few hours (or on
// demand); files are fetched only for items that are missing or changed.
import { mediaRepo, metaRepo } from '../data/repos';
import { isSafeMode } from '../config/safeMode';
import type { MediaPackItem } from '../data/schemas';
import { recordError } from './errorReport';
import { importMediaItems, mediaItemProblem, parseMediaManifest, MediaImportError, type MediaImportReport } from './mediaPack';

export const BUNDLED_MANIFEST_URL = '/media/manifest.json';
/** Meta key holding the last seeding result. */
export const BUNDLED_META_KEY = 'media:bundled';
/** Start-up checks happen at most this often; "Check now" ignores it. */
export const BUNDLED_CHECK_INTERVAL_MS = 6 * 3600_000;
const LAST_CHECK_KEY = 'zanshin:bundled-media-checked';
const PARALLEL_DOWNLOADS = 4;

export interface BundledMediaRecord {
  /** Identifies the pack the site serves (from its manifest, else a hash of its item hashes). */
  packId: string;
  createdAt?: string;
  checkedAt: string;
  seededAt?: string;
  total: number;
  imported: number;
  failed: number;
}

export type BundledMediaResult =
  | { status: 'skipped'; reason: 'offline' | 'safe-mode' | 'disabled' | 'recent' | 'unsupported' }
  | { status: 'none' }
  | { status: 'error'; message: string }
  | { status: 'done'; record: BundledMediaRecord; report: MediaImportReport };

export interface BundledMediaOptions {
  /** True to ignore the interval and check regardless. */
  force?: boolean;
  /** Mirrors the mediaBundledAuto setting; default true. */
  enabled?: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  nowIso?: () => string;
  fetcher?: typeof fetch;
  makeVariants?: boolean;
}

function readLastCheck(): number {
  try {
    return Number(window.localStorage.getItem(LAST_CHECK_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function writeLastCheck(ms: number): void {
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(ms));
  } catch {
    // Storage unavailable: the check simply runs again next time.
  }
}

/** A stable id for a manifest without one: its items' hashes in order. */
function fallbackPackId(items: MediaPackItem[]): string {
  let hash = 2166136261;
  for (const item of items) {
    for (const ch of `${item.kind}|${item.subjectKey}|${item.sha256}\n`) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `items-${items.length}-${hash.toString(16).padStart(8, '0')}`;
}

/** The last seeding result stored on this device, if any. */
export async function bundledMediaRecord(): Promise<BundledMediaRecord | null> {
  const row = await metaRepo.get(BUNDLED_META_KEY);
  if (!row || typeof row.value !== 'string') return null;
  try {
    return JSON.parse(row.value) as BundledMediaRecord;
  } catch {
    return null;
  }
}

/**
 * Checks the site's bundled media and stores whatever this device lacks.
 * Never throws: problems come back as { status: 'error' } and are recorded
 * for Diagnostics.
 */
export async function seedBundledMedia(options: BundledMediaOptions = {}): Promise<BundledMediaResult> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (fetcher === null) return { status: 'skipped', reason: 'unsupported' };
  if (options.enabled === false) return { status: 'skipped', reason: 'disabled' };
  if (isSafeMode()) return { status: 'skipped', reason: 'safe-mode' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'skipped', reason: 'offline' };
  const nowMs = Date.parse(nowIso());
  if (!options.force && nowMs - readLastCheck() < BUNDLED_CHECK_INTERVAL_MS) return { status: 'skipped', reason: 'recent' };

  let manifestText: string;
  try {
    const response = await fetcher(BUNDLED_MANIFEST_URL, { cache: 'no-cache', credentials: 'same-origin', signal: options.signal });
    if (response.status === 404) {
      writeLastCheck(nowMs);
      return { status: 'none' };
    }
    if (!response.ok) throw new Error(`The site answered HTTP ${response.status} for its media manifest.`);
    manifestText = await response.text();
  } catch (error) {
    if (options.signal?.aborted) return { status: 'skipped', reason: 'offline' };
    const message = error instanceof Error ? error.message : 'Could not read the site\'s media manifest.';
    recordError('bundledMedia.manifest', message);
    return { status: 'error', message };
  }

  let items: MediaPackItem[];
  let packId: string;
  let createdAt: string | undefined;
  try {
    const manifest = parseMediaManifest(manifestText, 'The site\'s media manifest');
    items = manifest.items;
    const declared = (manifest as Record<string, unknown>)['packId'];
    packId = typeof declared === 'string' && declared !== '' ? declared : fallbackPackId(items);
    createdAt = manifest.createdAt;
  } catch (error) {
    const message = error instanceof MediaImportError ? error.message : 'The site\'s media manifest is unreadable.';
    recordError('bundledMedia.manifest', message);
    return { status: 'error', message };
  }

  // Downloads run a few at a time, ahead of the importer and only for items
  // the device lacks (the importer skips unchanged items before asking).
  const existing = new Map((await mediaRepo.all()).map((row) => [row.id, row]));
  const wanted = items.filter((item) => {
    if (mediaItemProblem(item) !== null) return false;
    const row = existing.get(`${item.kind}|${item.subjectKey}`);
    return !(row && row.sha256 === item.sha256.toLowerCase() && row.bytes === item.bytes);
  });
  const downloads = new Map<MediaPackItem, Promise<Uint8Array | undefined>>();
  let queued = 0;
  const download = async (item: MediaPackItem): Promise<Uint8Array | undefined> => {
    const response = await fetcher(`/${item.file.replace(/^\/+/, '')}`, { credentials: 'same-origin', signal: options.signal });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const topUp = (): void => {
    while (queued < wanted.length && downloads.size < PARALLEL_DOWNLOADS) {
      const item = wanted[queued] as MediaPackItem;
      queued += 1;
      const promise = download(item);
      promise.catch(() => undefined);
      downloads.set(item, promise);
    }
  };
  const read = async (item: MediaPackItem): Promise<Uint8Array | undefined> => {
    topUp();
    const promise = downloads.get(item) ?? download(item);
    try {
      return await promise;
    } finally {
      downloads.delete(item);
      topUp();
    }
  };

  const report = await importMediaItems(items, read, {
    makeVariants: options.makeVariants,
    nowIso,
    onProgress: options.onProgress,
    origin: 'site',
    signal: options.signal,
  });
  downloads.clear();

  const previous = await bundledMediaRecord();
  const record: BundledMediaRecord = {
    checkedAt: nowIso(),
    createdAt,
    failed: report.failed.length,
    imported: report.imported,
    packId,
    seededAt: report.imported > 0 || !previous?.seededAt ? nowIso() : previous.seededAt,
    total: report.total,
  };
  await metaRepo.put({ key: BUNDLED_META_KEY, value: JSON.stringify(record) }).catch(() => undefined);
  writeLastCheck(nowMs);
  if (report.failed.length > 0) {
    recordError(
      'bundledMedia.items',
      `${report.failed.length} bundled media item(s) skipped: ${report.failed.slice(0, 5).map((f) => `${f.file} (${f.reason})`).join('; ')}`,
    );
  }
  return { record, report, status: 'done' };
}

/** Test hook. */
export function resetBundledMediaForTests(): void {
  try {
    window.localStorage.removeItem(LAST_CHECK_KEY);
  } catch {
    // ignore
  }
}
