// Amendment 01B — importing and exporting the local media library. Only the
// Media screen loads this module (it carries the zip code). Nothing here
// touches the network: media enters only from files Sagar picks.
//
// Media pack format (zanshin-media-pack, version 1): a zip holding
// manifest.json plus the files its items list. Each item names its kind,
// subjectKey, MIME type, byte count and SHA-256; unknown fields are ignored.
// Items are verified one at a time and unzipped one at a time, so a large
// pack never needs every file in memory at once.
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { mediaAssetId, mediaRepo } from '../data/repos';
import {
  mediaPackManifestSchema,
  type MediaAsset,
  type MediaBlob,
  type MediaKind,
  type MediaPackItem,
  type MediaVariant,
} from '../data/schemas';
import { extensionForMime, kindFitsSubject, mimeFitsKind } from '../domain/media/subjects';
import { sha256Sync } from './backup';
import { blobFromBytes, refreshMediaIndex } from './mediaLibrary';

export const MEDIA_PACK_FORMAT = 'zanshin-media-pack';
/** Largest single file accepted (a long PS5 clip at 1080p fits). */
export const MAX_MEDIA_FILE_BYTES = 300 * 1024 * 1024;
/** Widths of the downscaled copies made for portraits and key art. */
export const VARIANT_WIDTHS = [320, 640, 1080] as const;

export class MediaImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaImportError';
  }
}

export interface MediaImportFailure {
  file: string;
  subjectKey: string;
  reason: string;
}

export interface MediaImportReport {
  total: number;
  imported: number;
  replaced: number;
  failed: MediaImportFailure[];
  importedIds: string[];
}

export interface MediaImportOptions {
  onProgress?: (done: number, total: number) => void;
  /** Override for tests; defaults to the current time. */
  nowIso?: () => string;
  /** Make downscaled copies of portraits and key art (browser only). */
  makeVariants?: boolean;
}

/** SHA-256 of raw bytes as lowercase hex (Web Crypto, else the pure-TS fallback). */
export async function sha256BytesHex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    // Copy into a fresh ArrayBuffer: subarrays and cross-realm views are not
    // always accepted by digest().
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await subtle.digest('SHA-256', copy.buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Sync(bytes);
}

/** Bytes as a Uint8Array of this realm. Typed arrays made in another realm
 * (an iframe, or TextEncoder in some test environments) fail `instanceof`,
 * and fflate would then read them as folders, so views are re-wrapped
 * (without copying) and buffers are recognised by their tag. */
function ownBytes(view: ArrayBufferView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** A Blob's bytes; FileReader where Blob.arrayBuffer is missing (old engines, jsdom). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(blob);
  });
}

async function toBytes(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (ArrayBuffer.isView(input)) return ownBytes(input);
  if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') return new Uint8Array(input as ArrayBuffer);
  return blobBytes(input as Blob);
}

function needsVariants(kind: MediaKind): boolean {
  return kind === 'character-portrait' || kind === 'key-art';
}

/**
 * Reads an image's size and, when asked, makes downscaled WebP copies (PNG
 * where the browser cannot encode WebP) at the VARIANT_WIDTHS narrower than
 * the original. Returns no size and no copies wherever the browser lacks
 * createImageBitmap or a canvas, so imports still work there.
 */
export interface ImageAnalysis {
  width?: number;
  height?: number;
  variants: Array<{ width: number; mime: string; data: Uint8Array }>;
}

export async function analyzeImage(bytes: Uint8Array, mime: string, makeVariants: boolean): Promise<ImageAnalysis> {
  if (typeof createImageBitmap !== 'function') return { variants: [] };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blobFromBytes(bytes, mime));
  } catch {
    return { variants: [] };
  }
  const out: Array<{ width: number; mime: string; data: Uint8Array }> = [];
  const size = { height: bitmap.height, width: bitmap.width };
  if (!makeVariants) {
    bitmap.close?.();
    return { ...size, variants: out };
  }
  try {
    for (const width of VARIANT_WIDTHS) {
      if (width >= bitmap.width) continue;
      const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
      let blob: Blob | null = null;
      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(bitmap, 0, 0, width, height);
        blob = await canvas.convertToBlob({ quality: 0.82, type: 'image/webp' });
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) continue;
        context.drawImage(bitmap, 0, 0, width, height);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      }
      if (!blob) continue;
      out.push({ data: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/png', width });
    }
  } catch {
    return { ...size, variants: out };
  } finally {
    bitmap.close?.();
  }
  return { ...size, variants: out };
}

async function storeItem(args: {
  kind: MediaKind;
  subjectKey: string;
  mime: string;
  data: Uint8Array;
  sha256: string;
  width?: number;
  height?: number;
  sourcePage?: string;
  credit?: string;
  origin: MediaAsset['origin'];
  importedAt: string;
  makeVariants: boolean;
}): Promise<{ replaced: boolean; id: string }> {
  const id = mediaAssetId(args.kind, args.subjectKey);
  const existing = await mediaRepo.get(id);
  // Fresh blob keys per import, so a replaced row never shares keys with
  // its predecessor's blobs (the repository deletes those in the same
  // transaction).
  const stamp = `${Date.parse(args.importedAt) || 0}-${args.sha256.slice(0, 12)}`;
  const blobKey = `${id}#${stamp}`;
  const blobs: MediaBlob[] = [{ data: args.data, key: blobKey }];
  const variants: MediaVariant[] = [];
  let width = args.width;
  let height = args.height;
  if (args.kind !== 'move-clip' && (needsVariants(args.kind) || width === undefined)) {
    const analysis = await analyzeImage(args.data, args.mime, args.makeVariants && needsVariants(args.kind));
    width = width ?? analysis.width;
    height = height ?? analysis.height;
    for (const variant of analysis.variants) {
      const key = `${blobKey}@${variant.width}`;
      blobs.push({ data: variant.data, key });
      variants.push({ blobKey: key, bytes: variant.data.byteLength, mime: variant.mime, width: variant.width });
    }
  }
  const asset: MediaAsset = {
    blobKey,
    bytes: args.data.byteLength,
    id,
    importedAt: args.importedAt,
    kind: args.kind,
    mime: args.mime,
    origin: args.origin,
    sha256: args.sha256,
    subjectKey: args.subjectKey,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(variants.length > 0 ? { variants } : {}),
    ...(args.sourcePage ? { sourcePage: args.sourcePage } : {}),
    ...(args.credit ? { credit: args.credit } : {}),
  };
  await mediaRepo.put(asset, blobs);
  return { id, replaced: existing !== undefined };
}

function validateItem(item: MediaPackItem): string | null {
  if (!kindFitsSubject(item.kind, item.subjectKey)) return `${item.kind} cannot belong to ${item.subjectKey}`;
  if (!mimeFitsKind(item.kind, item.mime)) return `${item.mime} is not allowed for ${item.kind}`;
  if (item.bytes > MAX_MEDIA_FILE_BYTES) return 'file is larger than 300 MB';
  return null;
}

/** Reads one entry from the zip without unzipping the others. */
function readEntry(zip: Uint8Array, name: string): Uint8Array | undefined {
  const files = unzipSync(zip, { filter: (file) => file.name === name });
  return files[name];
}

/**
 * Imports a media pack. Throws MediaImportError when the zip or its
 * manifest is unusable (nothing is changed then). Individual items that
 * fail verification are skipped and reported; every other item is stored.
 */
export async function importMediaPack(
  input: Blob | ArrayBuffer | Uint8Array,
  options: MediaImportOptions = {},
): Promise<MediaImportReport> {
  const zip = await toBytes(input);
  let manifestBytes: Uint8Array | undefined;
  try {
    manifestBytes = readEntry(zip, 'manifest.json');
  } catch {
    throw new MediaImportError('This file is not a readable zip.');
  }
  if (!manifestBytes) throw new MediaImportError('The zip has no manifest.json, so it is not a ZANSHIN media pack.');
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new MediaImportError('manifest.json is not valid JSON.');
  }
  const parsed = mediaPackManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new MediaImportError(
      `manifest.json does not match the media pack format${first ? ` (${first.path.join('.') || 'root'}: ${first.message})` : ''}.`,
    );
  }
  const items = parsed.data.items;
  const now = options.nowIso ?? (() => new Date().toISOString());
  const makeVariants = options.makeVariants ?? true;
  const report: MediaImportReport = { failed: [], imported: 0, importedIds: [], replaced: 0, total: items.length };
  let done = 0;
  for (const item of items) {
    const problem = validateItem(item);
    let data: Uint8Array | undefined;
    if (problem === null) {
      try {
        data = readEntry(zip, item.file);
      } catch {
        data = undefined;
      }
    }
    if (problem !== null) {
      report.failed.push({ file: item.file, reason: problem, subjectKey: item.subjectKey });
    } else if (!data) {
      report.failed.push({ file: item.file, reason: 'file listed in the manifest is missing from the zip', subjectKey: item.subjectKey });
    } else if (data.byteLength !== item.bytes) {
      report.failed.push({ file: item.file, reason: `size is ${data.byteLength} bytes, manifest says ${item.bytes}`, subjectKey: item.subjectKey });
    } else {
      const sha256 = await sha256BytesHex(data);
      if (sha256 !== item.sha256.toLowerCase()) {
        report.failed.push({ file: item.file, reason: 'SHA-256 does not match the manifest', subjectKey: item.subjectKey });
      } else {
        const stored = await storeItem({
          credit: item.credit ?? undefined,
          data,
          height: item.height ?? undefined,
          importedAt: now(),
          kind: item.kind,
          makeVariants,
          mime: item.mime.toLowerCase(),
          origin: 'pack',
          sha256,
          sourcePage: item.sourcePage ?? undefined,
          subjectKey: item.subjectKey,
          width: item.width ?? undefined,
        });
        report.imported += 1;
        if (stored.replaced) report.replaced += 1;
        report.importedIds.push(stored.id);
      }
    }
    done += 1;
    options.onProgress?.(done, items.length);
  }
  await refreshMediaIndex();
  return report;
}

/** Adds one image or clip picked by Sagar, assigned to a kind and subject. */
export async function addMediaFile(
  file: Blob,
  kind: MediaKind,
  subjectKey: string,
  mime: string,
  options: { nowIso?: () => string; makeVariants?: boolean; dimensions?: { width: number; height: number } } = {},
): Promise<{ id: string; replaced: boolean }> {
  if (!kindFitsSubject(kind, subjectKey)) throw new MediaImportError(`${kind} cannot belong to ${subjectKey}.`);
  if (!mimeFitsKind(kind, mime)) {
    throw new MediaImportError(kind === 'move-clip'
      ? 'Clips must be MP4, WebM or MOV video.'
      : 'Images must be PNG, JPEG, WebP, GIF or AVIF.');
  }
  if (file.size > MAX_MEDIA_FILE_BYTES) throw new MediaImportError('That file is larger than 300 MB.');
  const data = await toBytes(file);
  const sha256 = await sha256BytesHex(data);
  const stored = await storeItem({
    credit: 'Imported by Sagar',
    data,
    importedAt: (options.nowIso ?? (() => new Date().toISOString()))(),
    kind,
    makeVariants: options.makeVariants ?? true,
    mime,
    origin: 'file',
    sha256,
    subjectKey,
    ...(options.dimensions ? { height: options.dimensions.height, width: options.dimensions.width } : {}),
  });
  await refreshMediaIndex();
  return stored;
}

function packFileName(asset: MediaAsset, index: number): string {
  const slug = asset.subjectKey.replace(/^[a-z]+:/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  return `media/${asset.kind}/${String(index + 1).padStart(4, '0')}-${slug}.${extensionForMime(asset.mime)}`;
}

/** Exports every imported item (originals, not downscaled copies) as a
 * media pack the importer reads back unchanged. */
export async function exportMediaPack(nowIso?: string): Promise<{ blob: Blob; fileName: string; count: number }> {
  const assets = await mediaRepo.all();
  const createdAt = nowIso ?? new Date().toISOString();
  const items: Array<Record<string, unknown>> = [];
  const files: Zippable = {};
  for (const [index, asset] of assets.entries()) {
    const data = await mediaRepo.blob(asset.blobKey);
    if (!data) continue;
    const file = packFileName(asset, index);
    files[file] = [ownBytes(data), { level: 0 }];
    items.push({
      bytes: data.byteLength,
      file,
      kind: asset.kind,
      mime: asset.mime,
      sha256: asset.sha256,
      subjectKey: asset.subjectKey,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
      ...(asset.sourcePage ? { sourcePage: asset.sourcePage } : {}),
      ...(asset.credit ? { credit: asset.credit } : {}),
    });
  }
  const manifest = { createdAt, format: MEDIA_PACK_FORMAT, generator: 'ZANSHIN Export media', items, version: 1 };
  const zipped = zipSync({
    'manifest.json': [ownBytes(new TextEncoder().encode(JSON.stringify(manifest, null, 1))), { level: 6 }],
    ...files,
  });
  const stamp = createdAt.replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  return {
    blob: new Blob([copy.buffer], { type: 'application/zip' }),
    count: items.length,
    fileName: `zanshin-media-${stamp}.zip`,
  };
}

/** Deletes one imported item. */
export async function deleteMedia(id: string): Promise<void> {
  await mediaRepo.remove(id);
  await refreshMediaIndex();
}

/** Deletes every imported item. */
export async function deleteAllMedia(): Promise<void> {
  await mediaRepo.clear();
  await refreshMediaIndex();
}
