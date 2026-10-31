// Amendment 01B — reading the local media library from screens. Light by
// design (no zip code here; that lives in mediaPack.ts and loads only on the
// Media screen), so every screen can show imported art without paying for it.
//
// - A small index of which kind+subject pairs exist is kept in memory and
//   mirrored to localStorage, so screens know synchronously whether to
//   reserve space for art (no layout shift) and skip the database entirely
//   when nothing was imported.
// - Object URLs are cached per blob and revoked whenever the library changes.
// - Display preferences come from Settings; absent fields mean the defaults.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { mediaAssetId, mediaRepo } from '../data/repos';
import type { MediaAsset, MediaKind, Settings } from '../data/schemas';
import { isSafeMode } from '../config/safeMode';
import { useAppStore } from '../stores/appStore';

const INDEX_KEY = 'zanshin:media-index';

let index: Set<string> = readStoredIndex();
let version = 0;
const listeners = new Set<() => void>();
const urlCache = new Map<string, string>();

function readStoredIndex(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = window.localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function storeIndex(): void {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify([...index]));
  } catch {
    // Storage unavailable: the in-memory index still works for this session.
  }
}

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function revokeAll(): void {
  for (const url of urlCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Nothing to revoke in environments without object URLs.
    }
  }
  urlCache.clear();
}

/** A Blob over stored bytes, without copying unless the bytes sit on a
 * SharedArrayBuffer (which Blob does not accept). */
export function blobFromBytes(bytes: Uint8Array, type: string): Blob {
  const part = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
  return new Blob([part], { type });
}

/** True when an asset of this kind exists for the subject (synchronous). */
export function hasMedia(kind: MediaKind, subjectKey: string): boolean {
  return index.has(mediaAssetId(kind, subjectKey));
}

/** How many assets of a kind the library holds (synchronous). */
export function mediaCount(kind?: MediaKind): number {
  if (kind === undefined) return index.size;
  let count = 0;
  for (const id of index) if (id.startsWith(`${kind}|`)) count += 1;
  return count;
}

/** Re-reads the index from the database, revokes cached URLs and notifies
 * every screen. Call after any import or delete. Never throws. */
export async function refreshMediaIndex(): Promise<void> {
  try {
    const rows = await mediaRepo.all();
    index = new Set(rows.map((row) => row.id));
    storeIndex();
  } catch {
    // Startup races (a closing test database) must never break a screen.
  }
  revokeAll();
  emit();
}

/** Test hook: forget the cached index and URLs. */
export function resetMediaLibraryForTests(): void {
  index = new Set();
  revokeAll();
  try {
    window.localStorage.removeItem(INDEX_KEY);
  } catch {
    // ignore
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the caller whenever the library changes. */
export function useMediaLibraryVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export interface MediaPrefs {
  showArt: boolean;
  inkArt: boolean;
  autoplay: boolean;
  speedCodex: number;
  speedLab: number;
}

export function mediaPrefsFrom(settings: Settings | null | undefined): MediaPrefs {
  return {
    showArt: settings?.mediaShowArt ?? true,
    inkArt: settings?.mediaInkArt ?? false,
    autoplay: settings?.mediaClipAutoplay ?? true,
    speedCodex: settings?.mediaClipSpeedCodex ?? 1,
    speedLab: settings?.mediaClipSpeedLab ?? 0.5,
  };
}

/** Display preferences for screens. Safe Mode (a minimal recovery shell
 * with no animation) shows no imported art at all; Settings → Images and
 * clips still lists the library there. */
export function useMediaPrefs(): MediaPrefs {
  const settings = useAppStore((s) => s.settings);
  const prefs = mediaPrefsFrom(settings);
  return isSafeMode() ? { ...prefs, autoplay: false, showArt: false } : prefs;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** The stored blob that best fits a display width: the smallest variant at
 * least that wide (times the pixel ratio), else the original. */
export function pickBlob(asset: MediaAsset, minWidth?: number): { key: string; mime: string } {
  if (minWidth === undefined || !asset.variants || asset.variants.length === 0) {
    return { key: asset.blobKey, mime: asset.mime };
  }
  const ratio = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const needed = minWidth * ratio;
  const fitting = [...asset.variants].sort((a, b) => a.width - b.width).find((variant) => variant.width >= needed);
  if (fitting) return { key: fitting.blobKey, mime: fitting.mime };
  if (asset.width !== undefined && asset.width >= needed) return { key: asset.blobKey, mime: asset.mime };
  const largest = [...asset.variants].sort((a, b) => b.width - a.width)[0];
  return largest && (asset.width === undefined || largest.width > asset.width)
    ? { key: largest.blobKey, mime: largest.mime }
    : { key: asset.blobKey, mime: asset.mime };
}

/** An object URL for the asset of this kind and subject, or null. */
export async function loadMediaUrl(
  kind: MediaKind,
  subjectKey: string,
  minWidth?: number,
): Promise<{ url: string; asset: MediaAsset } | null> {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const asset = await mediaRepo.find(kind, subjectKey);
  if (!asset) return null;
  const chosen = pickBlob(asset, minWidth);
  const cached = urlCache.get(chosen.key);
  if (cached) return { url: cached, asset };
  const bytes = await mediaRepo.blob(chosen.key);
  if (!bytes) return null;
  const url = URL.createObjectURL(blobFromBytes(bytes, chosen.mime));
  urlCache.set(chosen.key, url);
  return { url, asset };
}

export type MediaUrlState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; url: string; asset: MediaAsset }
  | { status: 'error' };

/**
 * The imported media for a kind and subject. 'none' when nothing was
 * imported or art is switched off (the caller shows its ink fallback), and
 * no database read happens in that case.
 */
export function useMediaUrl(
  kind: MediaKind,
  subjectKey: string | null,
  options: { minWidth?: number; enabled?: boolean } = {},
): MediaUrlState {
  const libraryVersion = useMediaLibraryVersion();
  const prefs = useMediaPrefs();
  const { minWidth, enabled = true } = options;
  const wanted = enabled && prefs.showArt && subjectKey !== null && hasMedia(kind, subjectKey);
  const requestKey = `${kind}|${subjectKey ?? ''}|${minWidth ?? ''}|${libraryVersion}`;
  const [result, setResult] = useState<{ key: string; state: MediaUrlState } | null>(null);

  useEffect(() => {
    if (!wanted || subjectKey === null) return undefined;
    let cancelled = false;
    loadMediaUrl(kind, subjectKey, minWidth)
      .then((loaded) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: loaded ? { status: 'ready', url: loaded.url, asset: loaded.asset } : { status: 'error' },
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: requestKey, state: { status: 'error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [wanted, kind, subjectKey, minWidth, requestKey]);

  if (!wanted) return { status: 'none' };
  if (result === null || result.key !== requestKey) return { status: 'loading' };
  return result.state;
}
