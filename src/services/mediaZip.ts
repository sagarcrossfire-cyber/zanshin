// Amendment 01B — media pack zips: reading a pack Sagar picked and writing one
// from the library. Only the Media screen loads this module, so fflate and the
// zip code stay out of the app shell (§13.8). Item verification and storage
// live in mediaPack.ts and are shared with the site's bundled media.
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { mediaRepo } from '../data/repos';
import type { MediaAsset } from '../data/schemas';
import { extensionForMime } from '../domain/media/subjects';
import {
  MEDIA_PACK_FORMAT,
  MediaImportError,
  importMediaItems,
  ownBytes,
  parseMediaManifest,
  toBytes,
  type MediaImportOptions,
  type MediaImportReport,
} from './mediaPack';

/** Reads one entry from the zip without unzipping the others. */
function readEntry(zip: Uint8Array, name: string): Uint8Array | undefined {
  const files = unzipSync(zip, { filter: (file) => file.name === name });
  return files[name];
}

/**
 * Imports a media pack zip. Throws MediaImportError when the zip or its
 * manifest is unusable (nothing is changed then); see importMediaItems for
 * how individual items are handled.
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
  const manifest = parseMediaManifest(new TextDecoder().decode(manifestBytes));
  return importMediaItems(manifest.items, async (item) => readEntry(zip, item.file), options);
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
