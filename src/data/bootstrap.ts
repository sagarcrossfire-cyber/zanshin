// First-run seeding and load — spec §6.3/§11.1. Packs are bundled JSON; the
// packs table holds the versioned copy the app reads its data-status from,
// and the conflicts table is seeded from the §10.14 conflict list.
import { DATA_PATCH, loadAllPacks, PACK_VERSION } from './packs';
import { conflictsRepo, packsRepo, profileRepo, settingsRepo } from './repos';
import type { PackRecord, Profile, Settings } from './schemas';
import { trackSeed } from './seedState';
import { DEFAULT_TARGET_RANK, PLATFORM_GLYPH } from '../config/ranks';

export function defaultProfile(nowIso: string): Profile {
  return {
    id: 'me',
    displayName: 'Sagar',
    platform: 'ps5',
    controller: 'DualSense',
    glyphMode: PLATFORM_GLYPH.ps5,
    targetRank: DEFAULT_TARGET_RANK,
    weeklyMinutes: 300,
    sessionMinutes: 30,
    preferredDays: [],
    dayBoundary: '04:00',
    timezone: 'America/Chicago',
    createdAt: nowIso,
    onboardingStep: 0,
    playedTekken7: true,
    tekken8Hours: 0,
  };
}

export function defaultSettings(): Settings {
  return {
    id: 'settings',
    theme: 'system',
    glyphMode: PLATFORM_GLYPH.ps5,
    labAudioCues: false,
    labWakeLock: true,
    repsPerSet: 10,
    newCardsPerDay: 10,
    reviewsPerDay: 60,
    aiProvider: 'none',
    aiRequestsPerHour: 20,
    snapshotsKeptDaily: 7,
    snapshotsKeptEvent: 5,
    backupReminderDays: 14,
    inAppImporterEnabled: true,
    matchImportEnabled: false,
    dataPatch: DATA_PATCH,
    dataSource: 'wavu',
    kpiTargets: {},
  };
}

function packRecord(kind: PackRecord['kind'], data: unknown): PackRecord {
  return {
    id: `${kind}-${PACK_VERSION}`,
    kind,
    patch: DATA_PATCH,
    version: PACK_VERSION,
    updatedAt: new Date().toISOString(),
    data,
    provenance: { source: 'wavu', patch: DATA_PATCH, sourceRev: '62125', status: 'sourced' },
  };
}

/** Profile + settings only: the two tiny writes that gate first paint
 * (§13.8 LCP). Pack seeding is the slow part (the 319-move bulkPut) and
 * runs separately in seedPacks, after ready is set. */
export async function ensureIdentity(): Promise<{ profile: Profile; settings: Settings }> {
  const existingProfile = await profileRepo.get();
  const profile = existingProfile ?? (await profileRepo.put(defaultProfile(new Date().toISOString())));
  const existingSettings = await settingsRepo.get();
  const settings = existingSettings ?? (await settingsRepo.put(defaultSettings()));
  return { profile, settings };
}

/** Seed any missing packs + conflicts from the bundled seed (R2).
 * `reseeded` lists kinds restored on a database that already had packs
 * (the recovery case); a fresh install reports none, so first run does not
 * show a misleading "refreshed" notice. Idempotent: concurrent callers
 * upsert the same records. */
export async function seedPacks(): Promise<{ reseeded: string[] }> {
  const run = seedPacksInner();
  trackSeed(run);
  return run;
}

async function seedPacksInner(): Promise<{ reseeded: string[] }> {
  const packData: Record<PackRecord['kind'], unknown> = (() => {
    const all = loadAllPacks();
    return {
      moves: all.moves, punishers: all.punishers, stances: all.stances,
      combos: all.combos, curriculum: all.curriculum, roster: all.roster,
      conflicts: all.conflicts, 'card-templates': all.cardTemplates,
    };
  })();
  const packs = await packsRepo.all();
  const present = new Set(packs.map((p) => p.kind));
  const missing = (Object.keys(packData) as PackRecord['kind'][]).filter((kind) => !present.has(kind));
  if (missing.length > 0) {
    await packsRepo.putMany(missing.map((kind) => packRecord(kind, packData[kind])));
  }
  const conflicts = await conflictsRepo.all();
  if (conflicts.length === 0) {
    for (const conflict of loadAllPacks().conflicts) {
      await conflictsRepo.put(conflict);
    }
  }
  return { reseeded: packs.length === 0 ? [] : missing };
}

/** Seed packs + conflicts tables when empty; create default profile/settings when absent.
 * R2: a single deleted pack is reseeded from the bundled seed, not only the
 * all-packs-missing case. `reseeded` lists kinds restored on a database
 * that already had packs (the recovery case); a fresh install reports none,
 * so first run does not show a misleading "refreshed" notice. */
export async function seedIfEmpty(): Promise<{ profile: Profile; settings: Settings; reseeded: string[] }> {
  const { profile, settings } = await ensureIdentity();
  const { reseeded } = await seedPacks();
  return { profile, settings, reseeded };
}
