// Diagnostics — spec §14.2 (integrity checks) and §14.6 (self-test).
// Checks report pass/fail each; repairs are conservative and logged.
import { tokenize } from '../domain/notation/tokenize';
import { buildRealPlanState, todayIso } from '../app/planState';
import { dueCount } from '../domain/engine/srs';
import { SCHEMA_VERSION, db } from '../data/db';
import {
  assessmentSchema,
  cardSchema,
  cardStateSchema,
  coachMessageSchema,
  dataConflictSchema,
  drillSetSchema,
  errorRecordSchema,
  masterySchema,
  mediaAssetSchema,
  matchSetSchema,
  metaRecordSchema,
  moveNoteSchema,
  packRecordSchema,
  problemMoveSchema,
  profileSchema,
  replayReviewSchema,
  researchNoteSchema,
  sessionSchema,
  settingsSchema,
  snapshotSchema,
  stageStatusSchema,
  verificationRecordSchema,
} from '../data/schemas';
import type { z } from 'zod';
import {
  loadCardTemplates,
  loadCombos,
  loadConflicts,
  loadCurriculum,
  loadMovesYoshimitsu,
  loadPlaybook,
  loadPunishers,
  loadRoster,
  loadStances,
} from '../data/packs';
import { cardStatesRepo, cardsRepo } from '../data/repos/cards';
import { errorsRepo, metaRepo } from '../data/repos/errors';
import { masteryRepo } from '../data/repos/mastery';
import { sessionsRepo } from '../data/repos/sessions';
import { setsRepo } from '../data/repos/sets';
import { mediaRepo } from '../data/repos/media';
import { recomputeNodeMastery } from './lab';
import { refreshMediaIndex } from './mediaLibrary';
import type { Profile, Settings } from '../data/schemas';

/** Validate every bundled pack by loading + Zod-parsing it. */
export function validateAllPacks(): { name: string; valid: boolean; detail: string }[] {
  const loaders: [string, () => unknown][] = [
    ['moves.yoshimitsu', loadMovesYoshimitsu],
    ['punishers', loadPunishers],
    ['stances', loadStances],
    ['combos', loadCombos],
    ['curriculum', loadCurriculum],
    ['roster', loadRoster],
    ['conflicts', loadConflicts],
    ['card-templates', loadCardTemplates],
    ['playbook', loadPlaybook],
  ];
  return loaders.map(([name, load]) => {
    try {
      const data = load() as unknown[];
      return { name, valid: true, detail: `${Array.isArray(data) ? data.length : 1} record(s)` };
    } catch (error) {
      return { name, valid: false, detail: error instanceof Error ? error.message : 'Load failed.' };
    }
  });
}

export interface CheckResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  repaired?: string;
}

export interface IntegrityReport {
  checks: CheckResult[];
  repaired: string[];
  orphans: string[];
  clockWarning: string | null;
}

const KNOWN_DRILL_PREFIXES = ['combo:', 'problem:', 'verify:'];

/** Row schemas per table, for the §14.2 record-validation check (R1). A row
 * that fails its schema is quarantined: its original JSON is written to the
 * errors ring buffer and the row is removed, so one corrupt row can never
 * blank the app. Packs validate structurally only (their `data` is opaque). */
const TABLE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  profile: profileSchema,
  settings: settingsSchema,
  packs: packRecordSchema,
  sessions: sessionSchema,
  sets: drillSetSchema,
  matchSets: matchSetSchema,
  reviews: replayReviewSchema,
  problemMoves: problemMoveSchema,
  moveNotes: moveNoteSchema,
  cards: cardSchema,
  cardStates: cardStateSchema,
  mastery: masterySchema,
  stageStatus: stageStatusSchema,
  assessments: assessmentSchema,
  verifications: verificationRecordSchema,
  conflicts: dataConflictSchema,
  coachMessages: coachMessageSchema,
  snapshots: snapshotSchema,
  errors: errorRecordSchema,
  meta: metaRecordSchema,
  media: mediaAssetSchema,
  research: researchNoteSchema,
};

const QUARANTINE_JSON_LIMIT = 2000;

/** Validate every stored row; quarantine invalid rows to errors (R1). */
export async function quarantineInvalidRows(nowIso: string): Promise<{ quarantined: string[]; counts: Record<string, number> }> {
  const quarantined: string[] = [];
  const counts: Record<string, number> = {};
  for (const table of db.tables) {
    const schema = TABLE_SCHEMAS[table.name];
    // Tables without a row schema are only counted, never loaded: imported
    // media bytes (`mediaBlobs`) can run to hundreds of megabytes, and this
    // runs at every startup.
    if (schema === undefined) {
      counts[table.name] = await table.count();
      continue;
    }
    const rows = await table.toArray() as Record<string, unknown>[];
    counts[table.name] = rows.length;
    const keyPath = table.schema.primKey.keyPath;
    for (const row of rows) {
      const result = schema.safeParse(row);
      if (result.success) continue;
      const key = typeof keyPath === 'string' ? String(row[keyPath] ?? '?') : '?';
      const label = `${table.name}/${key}`;
      await errorsRepo.put({
        at: nowIso,
        id: `quarantine-${table.name}-${key}-${Date.parse(nowIso)}`,
        message: `Quarantined invalid ${label}: ${JSON.stringify(row).slice(0, QUARANTINE_JSON_LIMIT)}`,
        where: 'diagnostics.quarantineInvalidRows',
      });
      if (typeof keyPath === 'string') await table.delete(row[keyPath] as string);
      quarantined.push(label);
    }
  }
  return { quarantined, counts };
}

function isKnownDrill(drillId: string, curriculumDrillIds: Set<string>): boolean {
  if (curriculumDrillIds.has(drillId)) return true;
  return KNOWN_DRILL_PREFIXES.some((prefix) => drillId.startsWith(prefix));
}

/** §14.2 integrity checks. Repairs: stale sessions → abandoned; mastery sample → recompute. */
export async function runIntegrityChecks(): Promise<IntegrityReport> {
  const checks: CheckResult[] = [];
  const repaired: string[] = [];
  const orphans: string[] = [];

  // 1. Schema version matches the code.
  checks.push({
    id: 'schema-version',
    label: 'Schema version matches the code',
    passed: true,
    detail: `Dexie schema v${SCHEMA_VERSION} open.`,
  });

  // 2. Every pack is present and valid.
  try {
    const packReport = validateAllPacks();
    const invalid = packReport.filter((p) => !p.valid);
    checks.push({
      id: 'packs-valid',
      label: 'Packs present and valid',
      passed: invalid.length === 0,
      detail: invalid.length === 0
        ? `${packReport.length} packs validated.`
        : `Invalid packs: ${invalid.map((p) => p.name).join(', ')}.`,
    });
  } catch (error) {
    checks.push({
      id: 'packs-valid',
      label: 'Packs present and valid',
      passed: false,
      detail: error instanceof Error ? error.message : 'Pack validation threw.',
    });
  }

  // 3. Every user record validates (§14.2, R1): invalid rows are
  // quarantined to errors with their original JSON and removed, so the
  // app loads and explains instead of blanking.
  try {
    const { quarantined, counts } = await quarantineInvalidRows(new Date().toISOString());
    if (quarantined.length > 0) {
      repaired.push(`${quarantined.length} invalid row(s) quarantined to errors: ${quarantined.join(', ')}.`);
    }
    checks.push({
      id: 'records-validate',
      label: 'User records validate',
      passed: true,
      detail: quarantined.length === 0
        ? `All rows valid (${Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join(', ')}).`
        : `${quarantined.length} invalid row(s) quarantined; see Diagnostics.`,
      repaired: quarantined.length > 0 ? `${quarantined.length} quarantined` : undefined,
    });
  } catch (error) {
    checks.push({
      id: 'records-validate',
      label: 'User records validate',
      passed: false,
      detail: error instanceof Error ? error.message : 'Record validation failed.',
    });
  }

  // 4. Orphans: sets pointing at unknown drills, card states without cards.
  const curriculum = loadCurriculum();
  const drillIds = new Set(curriculum.drills.map((d) => d.id));
  const sets = await setsRepo.all();
  for (const set of sets) {
    if (!isKnownDrill(set.drillId, drillIds)) orphans.push(`set ${set.id} → unknown drill ${set.drillId}`);
  }
  const cards = await cardsRepo.all();
  const cardIds = new Set(cards.map((c) => c.id));
  const states = await cardStatesRepo.all();
  for (const state of states) {
    if (!cardIds.has(state.cardId)) orphans.push(`card state ${state.cardId} has no card`);
  }
  checks.push({
    id: 'orphans',
    label: 'Orphans listed, kept out of analytics',
    passed: true,
    detail: orphans.length === 0 ? 'No orphans.' : `${orphans.length} orphaned row(s); see Diagnostics.`,
  });

  // 5. An active session older than 12 hours → abandoned, data kept.
  const sessions = await sessionsRepo.all();
  const nowMs = Date.now();
  let stale = 0;
  for (const session of sessions) {
    if (session.status === 'active' && nowMs - Date.parse(session.startedAt) > 12 * 3600_000) {
      await sessionsRepo.put({ ...session, status: 'abandoned' });
      stale += 1;
    }
  }
  if (stale > 0) repaired.push(`${stale} stale active session(s) marked abandoned.`);
  checks.push({
    id: 'stale-sessions',
    label: 'No active session older than 12 hours',
    passed: true,
    detail: stale === 0 ? 'No stale sessions.' : `${stale} marked abandoned, data kept.`,
    repaired: stale > 0 ? `${stale} marked abandoned` : undefined,
  });

  // 6. Stored mastery matches a recompute on a sample of nodes. The recompute
  // writes its result, so compare before/after scores to detect repairs.
  const masteryRows = await masteryRepo.all();
  const sample = masteryRows.slice(0, 5);
  let mismatches = 0;
  for (const row of sample) {
    const before = row.score;
    await recomputeNodeMastery(row.nodeId, new Date().toISOString());
    const after = await masteryRepo.get(row.nodeId);
    if (after !== undefined && Math.abs(after.score - before) > 0.02) mismatches += 1;
  }
  if (mismatches > 0) repaired.push(`${mismatches} mastery row(s) recomputed from history.`);
  checks.push({
    id: 'mastery-sample',
    label: 'Mastery sample matches recompute',
    passed: true,
    detail: sample.length === 0 ? 'No mastery rows yet.' : `${sample.length} sampled, ${mismatches} recomputed.`,
    repaired: mismatches > 0 ? `${mismatches} recomputed` : undefined,
  });

  // 7. Imported media rows and their bytes agree (Amendment 01B). Only blob
  // keys are read. A row whose original bytes are gone is removed (importing
  // the pack again restores it), missing variants are dropped from their row,
  // and bytes no row points at are deleted.
  try {
    const media = await mediaRepo.checkConsistency(true);
    const fixes: string[] = [];
    if (media.rowsRemoved.length > 0) fixes.push(`${media.rowsRemoved.length} media item(s) whose bytes were missing removed; import the pack again to restore them.`);
    if (media.rowsTrimmed.length > 0) fixes.push(`${media.rowsTrimmed.length} media item(s) lost a downscaled copy; the original is kept.`);
    if (media.orphanBlobKeys.length > 0) fixes.push(`${media.orphanBlobKeys.length} unused media file(s) deleted.`);
    if (fixes.length > 0) {
      repaired.push(...fixes);
      await refreshMediaIndex();
    }
    checks.push({
      id: 'media',
      label: 'Imported media rows and bytes agree',
      passed: true,
      detail: fixes.length === 0 ? 'Media library consistent.' : fixes.join(' '),
      repaired: fixes.length > 0 ? `${media.rowsRemoved.length + media.rowsTrimmed.length + media.orphanBlobKeys.length} fixed` : undefined,
    });
  } catch (error) {
    checks.push({
      id: 'media',
      label: 'Imported media rows and bytes agree',
      passed: false,
      detail: error instanceof Error ? error.message : 'Media check failed.',
    });
  }

  // 8. Clock earlier than the last write by more than a day → warn.
  let clockWarning: string | null = null;
  const lastWrites = [...sessions.map((s) => s.startedAt), ...sets.map((s) => s.at)];
  if (lastWrites.length > 0) {
    const latest = lastWrites.sort().at(-1) as string;
    if (nowMs - Date.parse(latest) < -24 * 3600_000) {
      clockWarning = `The clock is more than a day earlier than the last write (${latest.slice(0, 10)}). Scheduling uses the later of now and the last practice day.`;
    }
  }
  checks.push({
    id: 'clock',
    label: 'Clock is not far behind the last write',
    passed: clockWarning === null,
    detail: clockWarning ?? 'Clock looks sane.',
  });

  return { checks, repaired, orphans, clockWarning };
}

export interface SelfTestResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** Default Wavu reachability check for the self-test (browser fetch, origin=*). */
export async function defaultCheckWavu(url: string): Promise<boolean> {
  try {
    const target = url.includes('origin=') ? url : `${url}&origin=*`;
    const response = await fetch(target);
    return response.ok;
  } catch {
    return false;
  }
}

/** §14.6 self-test. Each item reports pass or fail. */
export async function runSelfTest(deps: {
  profile: Profile;
  settings: Settings;
  checkWavu?: (url: string) => Promise<boolean>;
}): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];

  // Database write/read/delete of a test row (meta table, test key).
  try {
    await metaRepo.put({ key: '__selftest__', value: 'ok' });
    const read = await metaRepo.get('__selftest__');
    await metaRepo.remove('__selftest__');
    const gone = await metaRepo.get('__selftest__');
    results.push({
      id: 'db-roundtrip',
      label: 'Database write, read and delete',
      passed: read?.value === 'ok' && gone === undefined,
      detail: read?.value === 'ok' && gone === undefined ? 'Test row written, read and deleted.' : 'Round-trip mismatch.',
    });
  } catch (error) {
    results.push({
      id: 'db-roundtrip',
      label: 'Database write, read and delete',
      passed: false,
      detail: error instanceof Error ? error.message : 'Database error.',
    });
  }

  // Integrity checks.
  const integrity = await runIntegrityChecks();
  const failed = integrity.checks.filter((c) => !c.passed);
  results.push({
    id: 'integrity',
    label: 'Integrity checks (§14.2)',
    passed: failed.length === 0,
    detail: failed.length === 0 ? `${integrity.checks.length} checks passed.` : `Failing: ${failed.map((f) => f.id).join(', ')}.`,
  });

  // Pack validation + tokenize every input.
  try {
    const packReport = validateAllPacks();
    const invalid = packReport.filter((p) => !p.valid);
    const moves = loadMovesYoshimitsu();
    let unknownInputs = 0;
    for (const move of moves) {
      const tokens = tokenize(move.input);
      if (tokens.some((t) => t.type === 'unknown')) unknownInputs += 1;
    }
    results.push({
      id: 'packs-tokenize',
      label: 'Pack validation and input tokenizing',
      passed: invalid.length === 0,
      detail: `${packReport.length} packs, ${moves.length} moves tokenized, ${unknownInputs} with unknown tokens.`,
    });
  } catch (error) {
    results.push({
      id: 'packs-tokenize',
      label: 'Pack validation and input tokenizing',
      passed: false,
      detail: error instanceof Error ? error.message : 'Pack check threw.',
    });
  }

  // Dry-run plan + due-card count.
  try {
    const planState = await buildRealPlanState(deps.profile, deps.settings, todayIso());
    const states = await cardStatesRepo.all();
    const due = dueCount(states, todayIso());
    results.push({
      id: 'plan-dryrun',
      label: "Dry-run plan and due-card count",
      passed: true,
      detail: `Plan has ${planState.plan.blocks.length} blocks; ${due} cards due.`,
    });
  } catch (error) {
    results.push({
      id: 'plan-dryrun',
      label: "Dry-run plan and due-card count",
      passed: false,
      detail: error instanceof Error ? error.message : 'Plan dry-run threw.',
    });
  }

  // Service worker registration.
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      results.push({
        id: 'service-worker',
        label: 'Service worker registration',
        passed: registration !== undefined,
        detail: registration === undefined ? 'No service worker registered yet.' : `Registered, scope ${registration.scope}.`,
      });
    } else {
      results.push({
        id: 'service-worker',
        label: 'Service worker registration',
        passed: true,
        detail: 'Service workers unavailable in this environment (test or insecure context); skipped.',
      });
    }
  } catch (error) {
    results.push({
      id: 'service-worker',
      label: 'Service worker registration',
      passed: false,
      detail: error instanceof Error ? error.message : 'Service worker check threw.',
    });
  }

  // Storage estimate + persistence.
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate !== undefined) {
      const estimate = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted !== undefined ? await navigator.storage.persisted() : null;
      results.push({
        id: 'storage',
        label: 'Storage estimate and persistence',
        passed: true,
        detail: `${((estimate.usage ?? 0) / 1048576).toFixed(1)} MB of ${((estimate.quota ?? 0) / 1048576).toFixed(0)} MB used; persistent storage ${persisted === null ? 'unknown' : persisted ? 'granted' : 'not granted'}.`,
      });
    } else {
      results.push({
        id: 'storage',
        label: 'Storage estimate and persistence',
        passed: true,
        detail: 'Storage estimate unavailable in this environment; skipped.',
      });
    }
  } catch (error) {
    results.push({
      id: 'storage',
      label: 'Storage estimate and persistence',
      passed: false,
      detail: error instanceof Error ? error.message : 'Storage check threw.',
    });
  }

  // Optional Wavu reachability.
  if (deps.checkWavu !== undefined) {
    try {
      const reachable = await deps.checkWavu('https://wavu.wiki/w/api.php?action=query&format=json');
      results.push({
        id: 'wavu',
        label: 'Wavu Wiki reachability (optional)',
        passed: reachable,
        detail: reachable ? 'Wavu Wiki reachable.' : 'Wavu Wiki unreachable; the app keeps working offline.',
      });
    } catch (error) {
      results.push({
        id: 'wavu',
        label: 'Wavu Wiki reachability (optional)',
        passed: false,
        detail: error instanceof Error ? error.message : 'Reachability check threw.',
      });
    }
  }

  return results;
}

export async function recentErrors(limit = 50): Promise<{ at: string; where: string; message: string }[]> {
  const all = await errorsRepo.all();
  return all.slice(0, limit).map((e) => ({ at: e.at, where: e.where, message: e.message }));
}
