// Patch Watch — spec §5.16/§7.7/§9.1. Checks Wavu Wiki through the shared
// importer (origin=*), diffs against the current pack, and applies updates
// with a snapshot first. Cards linked to changed moves become due today,
// one verify task (an open DataConflict) is queued per changed move, and
// verified provenance becomes sourced in the stored pack record.
//
// Displayed Codex data still comes from the bundled pack until the next app
// build ships the refreshed pack (§9.1 build-script path); the stored pack
// record, cards, verify tasks and banner all update immediately (D-054).
import { diffPacks, type PackDiff as ImportPackDiff } from '../data/import/diff';
import { fetchRevisionId, importMoves, type FetchLike } from '../data/import/wavu';
import { DATA_PATCH, DATA_SOURCE, PACK_VERSION, loadMovesYoshimitsu } from '../data/packs';
import { cardStatesRepo, cardsRepo } from '../data/repos/cards';
import { conflictsRepo, metaRepo } from '../data/repos/errors';
import { problemMovesRepo } from '../data/repos/problemMoves';
import { packsRepo } from '../data/repos/packs';
import { applyPatchImpact, type PackDiff as EnginePackDiff } from '../domain/engine/patch';
import { patchSummary } from '../domain/coach/rules';
import type { Move } from '../data/schemas';
import { takeSnapshot } from './snapshots';

export const PATCH_LAST_CHECK_KEY = 'patchWatch:lastCheck';
export const PATCH_REVISION_KEY = 'patchWatch:revision';
export const PATCH_LAST_APPLIED_KEY = 'patchWatch:lastApplied';
export const PATCH_LAST_DIFF_KEY = 'patchWatch:lastDiff';

/** The shared importer behind a FetchLike that uses the browser fetch. */
export const browserFetcher: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, text: async () => response.text() };
};

export interface PatchCheckResult {
  status: 'up-to-date' | 'update-available' | 'offline' | 'error';
  revision: string | undefined;
  previousRevision: string | undefined;
  diff: ImportPackDiff | null;
  moves: Move[] | null;
  checkedAt: string;
  message: string;
}

export interface AppliedPatchSummary {
  patch: string;
  revision: string | undefined;
  changedCount: number;
  addedCount: number;
  removedCount: number;
  cardsDueToday: string[];
  verifyTasks: number;
  bannerText: string;
  summaryText: string;
}

async function currentMoves(): Promise<Move[]> {
  const stored = await packsRepo.getByKind('moves');
  if (stored !== undefined && Array.isArray(stored.data)) {
    return stored.data as Move[];
  }
  return loadMovesYoshimitsu();
}

export async function currentRevision(): Promise<string | undefined> {
  const meta = await metaRepo.get(PATCH_REVISION_KEY);
  if (meta !== undefined) return meta.value;
  const stored = await packsRepo.getByKind('moves');
  return stored?.provenance.sourceRev;
}

export async function checkForUpdates(
  fetcher: FetchLike,
  nowIso?: string,
): Promise<PatchCheckResult> {
  const checkedAt = nowIso ?? new Date().toISOString();
  const previousRevision = await currentRevision();
  let moves: Move[];
  let revision: string | undefined;
  try {
    moves = await importMoves(fetcher);
    revision = await fetchRevisionId(fetcher, 'Yoshimitsu_movelist');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'network error';
    const offline = /network|fetch|failed|econnrefused|enotfound|timeout|abort/i.test(message);
    await metaRepo.put({ key: PATCH_LAST_CHECK_KEY, value: JSON.stringify({ checkedAt, status: offline ? 'offline' : 'error', message }) });
    return {
      status: offline ? 'offline' : 'error',
      revision: undefined,
      previousRevision,
      diff: null,
      moves: null,
      checkedAt,
      message: offline ? 'Offline. Showing the last known state.' : message,
    };
  }
  const oldMoves = await currentMoves();
  const diff = diffPacks(oldMoves, moves);
  const changed = diff.changed.length + diff.added.length + diff.removed.length;
  const upToDate = revision !== undefined && previousRevision !== undefined
    ? revision === previousRevision && changed === 0
    : changed === 0;
  const status = upToDate ? 'up-to-date' : 'update-available';
  await metaRepo.put({
    key: PATCH_LAST_CHECK_KEY,
    value: JSON.stringify({ checkedAt, status, revision, changed }),
  });
  return {
    status,
    revision,
    previousRevision,
    diff,
    moves,
    checkedAt,
    message: upToDate ? 'Data is up to date.' : `${changed} move(s) changed.`,
  };
}

/**
 * Apply a checked update: snapshot first, store the new pack, make linked
 * cards due today, queue verify tasks, flip provenance to sourced, mark
 * removed moves, and record the banner + summary for Patch Watch / Today.
 */
export async function applyPackUpdate(
  moves: Move[],
  diff: ImportPackDiff,
  revision: string | undefined,
  patch: string,
  today: string,
  nowIso?: string,
): Promise<AppliedPatchSummary> {
  const at = nowIso ?? new Date().toISOString();
  await takeSnapshot('pre-pack-update', at);
  const oldMoves = await currentMoves();
  const oldById = new Map(oldMoves.map((m) => [m.id, m]));

  // Cards linked to changed moves (via card refs) become due today.
  const cards = await cardsRepo.all();
  const cardsByMove: Record<string, string[]> = {};
  for (const card of cards) {
    for (const ref of card.refs) {
      const list = cardsByMove[ref] ?? [];
      list.push(card.id);
      cardsByMove[ref] = list;
    }
  }
  const engineDiff: EnginePackDiff = {
    patch,
    previousPatch: DATA_PATCH,
    changed: diff.changed.map((c) => ({
      moveId: c.id,
      num: c.num,
      input: oldById.get(c.id)?.input,
      changes: c.fields.map((f) => ({ field: f.field, oldValue: f.oldValue, newValue: f.newValue })),
    })),
    added: diff.added.map((m) => ({ moveId: m.id, num: m.num, input: m.input })),
    removed: diff.removed.map((m) => ({ moveId: m.id, num: m.num, input: m.input })),
  };
  const provenanceByMove: Record<string, string> = {};
  for (const move of oldMoves) provenanceByMove[move.id] = move.provenance.status;
  const impact = applyPatchImpact(engineDiff, { cardsByMove, provenanceByMove });

  const states = await cardStatesRepo.all();
  const stateByCard = new Map(states.map((s) => [s.cardId, s]));
  for (const cardId of impact.cardsDueToday) {
    const state = stateByCard.get(cardId);
    if (state !== undefined && state.due > today) {
      await cardStatesRepo.put({ ...state, due: today });
    } else if (state === undefined) {
      // No state yet: the card is new/fresh and already due; nothing to do.
    }
  }

  // One verify task per changed move (open conflict; the plan turns open
  // conflicts into verify blocks, at most 5 per plan).
  for (const task of impact.verifyTasks) {
    await conflictsRepo.put({
      id: `patch-verify-${task.moveId}`,
      entityId: task.moveId,
      field: task.field,
      values: [
        { source: 'previous', value: String(task.oldValue) },
        { source: 'patch', value: String(task.newValue) },
      ],
      status: 'open',
    });
  }

  // Provenance: verified becomes sourced in the stored pack.
  const resetIds = new Set(impact.provenanceResets.map((r) => r.moveId));
  const storedMoves = moves.map((move) =>
    resetIds.has(move.id)
      ? { ...move, provenance: { ...move.provenance, status: 'sourced' as const } }
      : move,
  );
  await packsRepo.put({
    id: `moves-${patch}-${revision ?? 'unknown'}`,
    kind: 'moves',
    patch,
    version: PACK_VERSION,
    updatedAt: at,
    data: storedMoves,
    provenance: {
      source: DATA_SOURCE === 'wavu+seed' ? 'wavu' : 'seed',
      sourceRev: revision,
      patch,
      status: 'sourced',
    },
  });
  // Exactly one current moves record: superseded records are removed (the
  // pre-update snapshot is the history mechanism). Otherwise getByKind could
  // return a stale record when timestamps tie.
  for (const pack of await packsRepo.all()) {
    if (pack.kind === 'moves' && pack.id !== `moves-${patch}-${revision ?? 'unknown'}`) {
      await packsRepo.remove(pack.id);
    }
  }

  // Removed moves: notes are keyed by moveId and untouched, so they are kept;
  // problem moves are kept and marked "move no longer in data".
  const removedIds = new Set(diff.removed.map((m) => m.id));
  const problems = await problemMovesRepo.all();
  for (const problem of problems) {
    if (problem.moveId !== undefined && removedIds.has(problem.moveId) && !problem.removedFromData) {
      await problemMovesRepo.put({ ...problem, removedFromData: true });
    }
  }

  const summaryText = patchSummary({
    patch,
    changed: diff.changed.flatMap((c) => c.fields.map((f) => ({ input: oldById.get(c.id)?.input ?? c.id, field: f.field, oldValue: f.oldValue, newValue: f.newValue }))),
    verifyCount: impact.verifyTasks.length,
    nextAction: 'Verify the changed moves in the next Lab session.',
  });
  const summary: AppliedPatchSummary = {
    patch,
    revision,
    changedCount: diff.changed.length,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    cardsDueToday: impact.cardsDueToday,
    verifyTasks: impact.verifyTasks.length,
    bannerText: impact.bannerText,
    summaryText,
  };
  await metaRepo.put({ key: PATCH_REVISION_KEY, value: revision ?? '' });
  await metaRepo.put({ key: PATCH_LAST_APPLIED_KEY, value: JSON.stringify(summary) });
  await metaRepo.put({
    key: PATCH_LAST_DIFF_KEY,
    value: JSON.stringify({
      patch,
      revision,
      changed: diff.changed,
      added: diff.added.map((m) => ({ id: m.id, num: m.num, input: m.input })),
      removed: diff.removed.map((m) => ({ id: m.id, num: m.num, input: m.input })),
    }),
  });
  return summary;
}

export async function lastAppliedSummary(): Promise<AppliedPatchSummary | null> {
  const meta = await metaRepo.get(PATCH_LAST_APPLIED_KEY);
  if (meta === undefined) return null;
  try {
    return JSON.parse(meta.value) as AppliedPatchSummary;
  } catch {
    return null;
  }
}

export async function lastCheckState(): Promise<{ checkedAt: string; status: string; revision?: string; changed?: number } | null> {
  const meta = await metaRepo.get(PATCH_LAST_CHECK_KEY);
  if (meta === undefined) return null;
  try {
    return JSON.parse(meta.value) as { checkedAt: string; status: string; revision?: string; changed?: number };
  } catch {
    return null;
  }
}

export async function lastDiffState(): Promise<{
  patch: string;
  revision: string | undefined;
  changed: ImportPackDiff['changed'];
  added: { id: string; num?: number; input: string }[];
  removed: { id: string; num?: number; input: string }[];
} | null> {
  const meta = await metaRepo.get(PATCH_LAST_DIFF_KEY);
  if (meta === undefined) return null;
  try {
    return JSON.parse(meta.value) as {
      patch: string;
      revision: string | undefined;
      changed: ImportPackDiff['changed'];
      added: { id: string; num?: number; input: string }[];
      removed: { id: string; num?: number; input: string }[];
    };
  } catch {
    return null;
  }
}
