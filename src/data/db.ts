// §6.3 — Dexie database 'zanshin', version 4, with the §6.3 tables and indexes
// plus the Amendment 01B media library tables.
import Dexie, { type Table } from 'dexie';
import { flushSeed } from './seedState';
import type {
  Assessment, Card, CardState, CoachMessage, DataConflict, DrillSet, ErrorRecord,
  Mastery, MatchSet, MediaAsset, MediaBlob, MetaRecord, MoveNote, PackRecord, ProblemMove, Profile,
  ReplayReview, Session, Settings, Snapshot, StageStatus, VerificationRecord,
} from './schemas';

/**
 * Migration framework (§6.3): one Dexie version upgrade per schema version.
 * A snapshot is taken before every migration (callers snapshot via the snapshots
 * repo before calling `db` upgrade paths), and migration tests run against
 * fixture databases from every earlier version.
 *
 * Version 1: the initial schema.
 * Version 2: additive `at` index on `reviews` (reviewsRepo.all() orders by
 * `at`; v1 crashed with a SchemaError on any call). Index-only: Dexie
 * creates the index natively, no row migration, no user data touched.
 * Version 3: snapshot payload value shape only — `data` is a Uint8Array
 * instead of a Blob (D-059). Indexes unchanged; no row migration needed.
 * Version 4 (1.1.0, Amendment 01B): two new tables for the local media
 * library, `media` (one row per imported image or clip) and `mediaBlobs`
 * (their bytes). Additive: no existing table or row changes.
 * Keep NEXT_SCHEMA_VERSION in sync with the highest registered version.
 */
export const SCHEMA_VERSION = 4;
export const NEXT_SCHEMA_VERSION = 5;

/** v1 stores, kept for the v1→v2 migration test. */
export const V1_STORES: Record<string, string> = {
  meta: 'key',
  profile: 'id',
  settings: 'id',
  packs: 'id, kind, patch',
  sessions: 'id, startedAt, status',
  sets: 'id, sessionId, drillId, nodeId, day, at',
  matchSets: 'id, day, opponentCharacter, importRef, at',
  reviews: 'id, matchSetId',
  problemMoves: 'id, character',
  moveNotes: 'moveId, character',
  cards: 'id, deck, createdAt',
  cardStates: 'cardId, due',
  mastery: 'nodeId, state',
  stageStatus: 'stageId, state',
  assessments: 'id, at',
  verifications: 'id, entityId, at',
  conflicts: 'id, entityId, status',
  coachMessages: 'id, threadId, at',
  snapshots: 'id, at, reason',
  errors: 'id, at, where',
};

/** v2 stores: v1 plus the `reviews.at` index. */
export const V2_STORES: Record<string, string> = {
  ...V1_STORES,
  reviews: 'id, matchSetId, at',
};

/** v3 stores: identical indexes to v2 (value-shape change only, D-059). */
export const V3_STORES: Record<string, string> = { ...V2_STORES };

/** v4 stores: v3 plus the media library (Amendment 01B). */
export const V4_STORES: Record<string, string> = {
  ...V3_STORES,
  media: 'id, kind, subjectKey, importedAt',
  mediaBlobs: 'key',
};

export class ZanshinDb extends Dexie {
  meta!: Table<MetaRecord, string>;
  profile!: Table<Profile, string>;
  settings!: Table<Settings, string>;
  packs!: Table<PackRecord, string>;
  sessions!: Table<Session, string>;
  sets!: Table<DrillSet, string>;
  matchSets!: Table<MatchSet, string>;
  reviews!: Table<ReplayReview, string>;
  problemMoves!: Table<ProblemMove, string>;
  moveNotes!: Table<MoveNote, string>;
  cards!: Table<Card, string>;
  cardStates!: Table<CardState, string>;
  mastery!: Table<Mastery, string>;
  stageStatus!: Table<StageStatus, string>;
  assessments!: Table<Assessment, string>;
  verifications!: Table<VerificationRecord, string>;
  conflicts!: Table<DataConflict, string>;
  coachMessages!: Table<CoachMessage, string>;
  snapshots!: Table<Snapshot, string>;
  errors!: Table<ErrorRecord, string>;
  media!: Table<MediaAsset, string>;
  mediaBlobs!: Table<MediaBlob, string>;

  constructor() {
    super('zanshin');
    this.version(1).stores(V1_STORES);
    this.version(2).stores(V2_STORES);
    this.version(3).stores(V3_STORES);
    this.version(4).stores(V4_STORES);
  }
}

/** Singleton database instance; repositories are the only code that touches it (§6.2). */
export const db = new ZanshinDb();

function isTestEnv(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return env?.['NODE_ENV'] === 'test' || env?.['VITEST'] === 'true';
  } catch {
    return false;
  }
}

/**
 * Deletes and reopens the database for tests. Guarded: throws outside a test
 * environment so production data can never be wiped through this helper.
 */
export async function resetDbForTests(): Promise<void> {
  if (!isTestEnv()) {
    throw new Error('resetDbForTests is only available in a test environment');
  }
  // A background seedPacks from a previous test's render must finish before
  // the delete, or its writes land in the next test's database (§13.9/§14).
  await flushSeed();
  await db.close();
  await Dexie.delete('zanshin');
  await db.open();
}

/** True when an async load raced the test teardown that closes the DB. Only
 * this error may be ignored by screen loads; everything else rethrows.
 * (Moved to src/data/dbErrors.ts so screens can import it without touching
 * Dexie — see the no-direct-storage-fetch rule.) */
export { isDatabaseClosedError } from './dbErrors';
