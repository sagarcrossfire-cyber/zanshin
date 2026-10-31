// Backup format — spec §6.6. Canonical JSON (sorted keys, no whitespace),
// SHA-256 over the canonical JSON of `tables`. API keys are excluded unless
// `includeSecrets` is explicitly on; packs are excluded unless
// `includePacks` is on (they can be re-imported).
import {
  assessmentsRepo,
  cardStatesRepo,
  cardsRepo,
  coachMessagesRepo,
  conflictsRepo,
  errorsRepo,
  masteryRepo,
  matchSetsRepo,
  moveNotesRepo,
  packsRepo,
  problemMovesRepo,
  profileRepo,
  sessionsRepo,
  setsRepo,
  settingsRepo,
  stageStatusRepo,
} from '../data/repos';
import { metaRepo, verificationsRepo } from '../data/repos/errors';
import { reviewsRepo } from '../data/repos/matchSets';
import type { Profile, Settings } from '../data/schemas';

export const BACKUP_FORMAT = 'zanshin-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.1.0';

/** Tables included in every backup, in canonical order. */
export const BACKUP_TABLES = [
  'profile',
  'settings',
  'sessions',
  'sets',
  'matchSets',
  'reviews',
  'mastery',
  'stageStatus',
  'cards',
  'cardStates',
  'moveNotes',
  'assessments',
  'conflicts',
  'problemMoves',
  'coachMessages',
  'verifications',
  'errors',
  'meta',
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export type BackupTables = Record<BackupTableName, unknown[]> & { packs?: unknown[] };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  includesPacks: boolean;
  includesSecrets: boolean;
  tables: BackupTables;
  sha256: string;
}

/** Canonical JSON: object keys sorted recursively, no whitespace, arrays in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  // Drop undefined-valued keys, matching JSON.stringify: otherwise the hash
  // computed before serialization differs from the hash of the parsed file
  // (validateBackup recomputes from parsed tables) and an export can never
  // re-validate itself. Array slots keep the scalar 'null' branch above,
  // also matching JSON.stringify.
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

// --- SHA-256: Web Crypto when available, pure-TS fallback otherwise. --------

/** Pure-TS SHA-256, used when Web Crypto is unavailable. Exported for vector tests. */
export function sha256Sync(data: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotr = (x: number, y: number): number => (x >>> y) | (x << (32 - y));
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15] as number, 7) ^ rotr(w[i - 15] as number, 18) ^ ((w[i - 15] as number) >>> 3);
      const s1 = rotr(w[i - 2] as number, 17) ^ rotr(w[i - 2] as number, 19) ^ ((w[i - 2] as number) >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (K[i] as number) + (w[i] as number)) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Sync(new TextEncoder().encode(text));
}

// --- Export / import ---------------------------------------------------------

async function readTables(includePacks: boolean, includeSecrets: boolean): Promise<BackupTables> {
  const [
    profile, settings, sessions, sets, matchSets, reviews, mastery, stageStatus,
    cards, cardStates, moveNotes, assessments, conflicts, problemMoves,
    coachMessages, errors, meta, verifications,
  ] = await Promise.all([
    profileRepo.all(),
    settingsRepo.all(),
    sessionsRepo.all(),
    setsRepo.all(),
    matchSetsRepo.all(),
    reviewsRepo.all(),
    masteryRepo.all(),
    stageStatusRepo.all(),
    cardsRepo.all(),
    cardStatesRepo.all(),
    moveNotesRepo.all(),
    assessmentsRepo.all(),
    conflictsRepo.all(),
    problemMovesRepo.all(),
    coachMessagesRepo.all(),
    errorsRepo.all(),
    metaRepo.all(),
    verificationsRepo.all(),
  ]);
  const safeSettings = includeSecrets
    ? settings
    : settings.map((row) => {
        const { aiApiKey: _dropped, ...rest } = row as Settings & { aiApiKey?: string };
        return rest;
      });
  const tables: BackupTables = {
    profile,
    settings: safeSettings,
    sessions,
    sets,
    matchSets,
    reviews,
    mastery,
    stageStatus,
    cards,
    cardStates,
    moveNotes,
    assessments,
    conflicts,
    problemMoves,
    coachMessages,
    errors,
    meta,
    verifications,
  };
  if (includePacks) {
    tables.packs = await packsRepo.all();
  }
  return tables;
}

export async function exportBackup(options: {
  includePacks: boolean;
  includeSecrets: boolean;
  exportedAt?: string;
}): Promise<BackupFile> {
  const tables = await readTables(options.includePacks, options.includeSecrets);
  const sha256 = await sha256Hex(canonicalJson(tables));
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    includesPacks: options.includePacks,
    includesSecrets: options.includeSecrets,
    tables,
    sha256,
  };
}

export function backupFileName(exportedAt: string): string {
  const compact = exportedAt.replace(/[-:]/g, '').slice(0, 12);
  return `zanshin-backup-${compact.slice(0, 8)}-${compact.slice(8, 12)}.json`;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate format, schema version and hash. Throws BackupError; changes nothing. */
export async function validateBackup(file: unknown): Promise<BackupFile> {
  if (!isRecord(file)) throw new BackupError('Backup is not a JSON object.');
  if (file.format !== BACKUP_FORMAT) throw new BackupError('Not a ZANSHIN backup file.');
  if (file.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupError(`Unsupported backup schema version ${String(file.schemaVersion)}.`);
  }
  if (typeof file.sha256 !== 'string' || !isRecord(file.tables)) {
    throw new BackupError('Backup is missing its hash or tables.');
  }
  const computed = await sha256Hex(canonicalJson(file.tables));
  if (computed !== file.sha256) throw new BackupError('Backup hash does not match its contents.');
  for (const name of BACKUP_TABLES) {
    if (!Array.isArray((file.tables as Record<string, unknown>)[name])) {
      throw new BackupError(`Backup table "${name}" is missing or not an array.`);
    }
  }
  return file as unknown as BackupFile;
}

interface TableAdapter {
  clear: () => Promise<void>;
  put: (row: unknown) => Promise<unknown>;
  keyOf: (row: unknown) => string;
}

function adapterFor<Row>(
  all: () => Promise<Row[]>,
  remove: (id: string) => Promise<void>,
  put: (row: Row) => Promise<unknown>,
  keyOf: (row: Row) => string,
): TableAdapter {
  return {
    clear: async () => {
      const rows = await all();
      for (const row of rows) await remove(keyOf(row));
    },
    put: (row: unknown) => put(row as Row),
    keyOf: (row: unknown) => keyOf(row as Row),
  };
}

function idKey(row: { id: string }): string {
  return row.id;
}

const TABLE_ADAPTERS: Record<BackupTableName, TableAdapter> = {
  profile: {
    clear: () => profileRepo.remove(),
    put: (row: unknown) => profileRepo.put(row as Profile),
    keyOf: () => 'me',
  },
  settings: {
    clear: () => settingsRepo.remove(),
    put: (row: unknown) => settingsRepo.put(row as Settings),
    keyOf: () => 'settings',
  },
  sessions: adapterFor(sessionsRepo.all, sessionsRepo.remove, sessionsRepo.put, idKey),
  sets: adapterFor(setsRepo.all, setsRepo.remove, setsRepo.put, idKey),
  matchSets: adapterFor(matchSetsRepo.all, matchSetsRepo.remove, matchSetsRepo.put, idKey),
  reviews: adapterFor(reviewsRepo.all, reviewsRepo.remove, reviewsRepo.put, idKey),
  mastery: adapterFor(masteryRepo.all, masteryRepo.remove, masteryRepo.put, (row: { nodeId: string }) => row.nodeId),
  stageStatus: adapterFor(stageStatusRepo.all, stageStatusRepo.remove, stageStatusRepo.put, (row: { stageId: string }) => row.stageId),
  cards: adapterFor(cardsRepo.all, cardsRepo.remove, cardsRepo.put, idKey),
  cardStates: adapterFor(cardStatesRepo.all, cardStatesRepo.remove, cardStatesRepo.put, (row: { cardId: string }) => row.cardId),
  moveNotes: adapterFor(moveNotesRepo.all, moveNotesRepo.remove, moveNotesRepo.put, (row: { moveId: string }) => row.moveId),
  assessments: adapterFor(assessmentsRepo.all, assessmentsRepo.remove, assessmentsRepo.put, idKey),
  conflicts: adapterFor(conflictsRepo.all, conflictsRepo.remove, conflictsRepo.put, idKey),
  problemMoves: adapterFor(problemMovesRepo.all, problemMovesRepo.remove, problemMovesRepo.put, idKey),
  coachMessages: adapterFor(coachMessagesRepo.all, coachMessagesRepo.remove, coachMessagesRepo.put, idKey),
  verifications: adapterFor(verificationsRepo.all, verificationsRepo.remove, verificationsRepo.put, idKey),
  errors: adapterFor(errorsRepo.all, errorsRepo.remove, errorsRepo.put, idKey),
  meta: adapterFor(metaRepo.all, metaRepo.remove, metaRepo.put, (row: { key: string }) => row.key),
};

/**
/**
 * Replace every user table with the backup's rows. The caller snapshots first
 * (§6.6) and validates first; on any write failure the error propagates and
 * the caller must restore from that snapshot. A secrets-excluded backup never
 * wipes a stored API key: the key on the current settings row is restored
 * after import (it can only be cleared in Settings).
 */
export async function importBackup(file: BackupFile, takeSnapshotFirst: () => Promise<void>): Promise<Record<string, number>> {
  const storedKey = (await settingsRepo.get())?.aiApiKey;
  await takeSnapshotFirst();
  const counts: Record<string, number> = {};
  for (const name of BACKUP_TABLES) {
    const rows = (file.tables[name] ?? []) as unknown[];
    const writer = TABLE_ADAPTERS[name];
    await writer.clear();
    for (const row of rows) await writer.put(row as never);
    counts[name] = rows.length;
  }
  if (file.includesPacks && file.tables.packs !== undefined) {
    const packs = file.tables.packs as never[];
    const existing = await packsRepo.all();
    for (const pack of existing) await packsRepo.remove(pack.id);
    if (packs.length > 0) await packsRepo.putMany(packs);
    counts.packs = packs.length;
  }
  if (!file.includesSecrets && storedKey !== undefined && storedKey !== '') {
    const imported = await settingsRepo.get();
    if (imported !== undefined && (imported.aiApiKey === undefined || imported.aiApiKey === '')) {
      await settingsRepo.put({ ...imported, aiApiKey: storedKey });
    }
  }
  return counts;
}

/**
 * Clear every backed-up table except `snapshots`, so a pre-reset snapshot
 * survives the reset it guards (AC-SET-2). The caller reloads afterwards
 * and bootstrap reseeds fresh defaults.
 */
export async function clearAllUserTables(): Promise<void> {
  // BACKUP_TABLES excludes `snapshots` by design, so snapshots survive.
  for (const name of BACKUP_TABLES) {
    await TABLE_ADAPTERS[name].clear();
  }
  const existing = await packsRepo.all();
  for (const pack of existing) await packsRepo.remove(pack.id);
}
