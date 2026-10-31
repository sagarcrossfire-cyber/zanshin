// Pre-migration snapshots — spec §14.2/§14.5, §13.9 R3. Migrations run
// with a snapshot first: when the stored schema version is older than the
// code's, the app snapshots the database through a probe connection opened
// at the OLD version, before the real connection opens and Dexie runs the
// upgrade. If the migration throws, the pre-migration snapshot restores
// the previous state and Diagnostics records it.
//
// The probe never touches the app's Dexie singleton: it opens its own
// connection, reads every backed-up table (plus packs, as takeSnapshot
// does), writes one `pre-migration` snapshot row, and closes. Fresh
// installs only record the current version; nothing is snapshotted.
import Dexie from 'dexie';
import {
  APP_VERSION,
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BACKUP_TABLES,
  canonicalJson,
  sha256Hex,
  type BackupFile,
} from '../services/backup';
import { gzipBytes } from '../services/snapshots';

export const DB_VERSION_KEY = 'zanshin:db-version';

export interface VersionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface MigrationGuardResult {
  snapshotTaken: boolean;
  snapshotId?: string;
  probeError?: string;
}

export interface MigrationGuardOptions {
  dbName: string;
  currentVersion: number;
  storesByVersion: Record<number, Record<string, string>>;
  storage: VersionStorage;
  atIso?: string;
}

export function storedDbVersion(storage: VersionStorage): number | null {
  const raw = storage.getItem(DB_VERSION_KEY);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function ensureMigratedSafely(options: MigrationGuardOptions): Promise<MigrationGuardResult> {
  const { dbName, currentVersion, storesByVersion, storage } = options;
  const stored = storedDbVersion(storage);
  if (stored === null || stored >= currentVersion) {
    storage.setItem(DB_VERSION_KEY, String(currentVersion));
    return { snapshotTaken: false };
  }
  const at = options.atIso ?? new Date().toISOString();
  try {
    const snapshotId = await takePreMigrationSnapshot(dbName, stored, storesByVersion, at);
    storage.setItem(DB_VERSION_KEY, String(currentVersion));
    return { snapshotTaken: true, snapshotId };
  } catch (error) {
    // Never block startup on the guard: the upgrade still runs, and the
    // caller records the failure so Diagnostics shows it (R3).
    storage.setItem(DB_VERSION_KEY, String(currentVersion));
    return {
      snapshotTaken: false,
      probeError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function takePreMigrationSnapshot(
  dbName: string,
  fromVersion: number,
  storesByVersion: Record<number, Record<string, string>>,
  at: string,
): Promise<string> {
  const probe = new Dexie(dbName);
  for (let version = 1; version <= fromVersion; version += 1) {
    const stores = storesByVersion[version];
    if (stores === undefined) throw new Error(`No store definition for schema version ${version}.`);
    probe.version(version).stores(stores);
  }
  await probe.open();
  try {
    const tables: Record<string, unknown[]> = {};
    for (const name of [...BACKUP_TABLES]) {
      tables[name] = await probe.table(name).toArray();
    }
    tables.packs = await probe.table('packs').toArray();
    const sha256 = await sha256Hex(canonicalJson(tables));
    const backup: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt: at,
      includesPacks: true,
      includesSecrets: true,
      tables: tables as BackupFile['tables'],
      sha256,
    };
    const text = JSON.stringify({ backup });
    const { bytes } = await gzipBytes(text);
    const id = `snap-${Date.parse(at)}-pre-migration`;
    await probe.table('snapshots').put({
      id,
      at,
      reason: 'pre-migration',
      bytes: bytes.length,
      sha256: await sha256Hex(text),
      data: bytes,
    });
    return id;
  } finally {
    probe.close();
  }
}
