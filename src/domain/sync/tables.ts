// M3 — the sync table classification. Single source of truth for every later sync card.
// Pure, no Dexie, no fetch, no UI; `ZanshinDb`'s table list (src/data/db.ts) is the ground truth
// this file must cover exactly once (see tests/unit/sync/tables.spec.ts).

/**
 * Append-only, merged as a pure union by `id`. A record in this class is never rewritten after
 * creation, so "newest wins" never applies — every id seen from any device is kept.
 */
export const UNION_TABLES = [
  'sets',
  'assessments',
  'verifications',
  'coachMessages',
  'research',
  'reviews',
] as const;

/**
 * Mutable, last-writer-wins per record by HLC. Includes `sessions` and `matchSets`: both can be
 * edited after creation (session status changes; a re-sync can extend a ranked matchSet and the
 * edit form flips `tallied`), so records with the same id resolve by newest HLC, not by union.
 */
export const LWW_TABLES = [
  'profile',
  'settings',
  'cards',
  'cardStates',
  'moveNotes',
  'problemMoves',
  'stageStatus',
  'conflicts',
  'sessions',
  'matchSets',
] as const;

/** Derived from synced data after merge (e.g. `mastery` from `sets`); never synced directly. */
export const DERIVED_TABLES = ['mastery'] as const;

/** Device-local; never leaves the device and is never accepted from a remote change. */
export const DEVICE_LOCAL_TABLES = ['meta', 'packs', 'media', 'mediaBlobs', 'snapshots', 'errors'] as const;

export type UnionTable = (typeof UNION_TABLES)[number];
export type LwwTable = (typeof LWW_TABLES)[number];
export type DerivedTable = (typeof DERIVED_TABLES)[number];
export type DeviceLocalTable = (typeof DEVICE_LOCAL_TABLES)[number];

/** Every table that can appear in a sync change (union + LWW). */
export const SYNCED_TABLES = [...UNION_TABLES, ...LWW_TABLES] as const;
export type SyncedTable = UnionTable | LwwTable;

/** Every table name known to the Dexie schema, across all four classes. */
export const ALL_TABLE_NAMES = [
  ...UNION_TABLES,
  ...LWW_TABLES,
  ...DERIVED_TABLES,
  ...DEVICE_LOCAL_TABLES,
] as const;
export type AllTableName = (typeof ALL_TABLE_NAMES)[number];

export type SyncTableClass = 'union' | 'lww' | 'derived' | 'device-local';

const UNION_SET: ReadonlySet<string> = new Set(UNION_TABLES);
const LWW_SET: ReadonlySet<string> = new Set(LWW_TABLES);
const DERIVED_SET: ReadonlySet<string> = new Set(DERIVED_TABLES);
const DEVICE_LOCAL_SET: ReadonlySet<string> = new Set(DEVICE_LOCAL_TABLES);

/** Classify a Dexie table name. Throws if the name is not in any of the four classes. */
export function classifyTable(table: string): SyncTableClass {
  if (UNION_SET.has(table)) return 'union';
  if (LWW_SET.has(table)) return 'lww';
  if (DERIVED_SET.has(table)) return 'derived';
  if (DEVICE_LOCAL_SET.has(table)) return 'device-local';
  throw new Error(`unclassified sync table: ${table}`);
}

export function isSyncedTable(table: string): table is SyncedTable {
  return UNION_SET.has(table) || LWW_SET.has(table);
}

/** Settings fields that must never leave the device: `aiApiKey` and anything ending Key/Token/Secret. */
export const DEVICE_LOCAL_SETTINGS_FIELD_PATTERN = /(Key|Token|Secret)$/;

/**
 * Strip every device-local field (API keys, tokens, secrets) from a settings record before it is
 * put in a sync change. Generic over the field pattern, not a hardcoded field list, so a newly
 * added secret-shaped field is stripped automatically (and the accompanying test fails loudly if
 * a new field happens to dodge the pattern while still looking like a credential).
 */
export function stripDeviceLocalSettings<T extends Record<string, unknown>>(settings: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(settings) as (keyof T & string)[]) {
    if (DEVICE_LOCAL_SETTINGS_FIELD_PATTERN.test(key)) continue;
    out[key] = settings[key];
  }
  return out;
}
