// P10 — Patch Watch (§5.16/§7.7/§9.1): golden diff (AC-PATCH-2), update
// checks incl. offline calm behavior (AC-PATCH-1), apply with snapshot,
// cards-due, verify tasks, provenance reset and banner (AC-PATCH-4, G6),
// and restore returning the exact prior pack (AC-PATCH-3).
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffPacks, type PackDiff } from '../../src/data/import/diff';
import { importMoves, type FetchLike } from '../../src/data/import/wavu';
import { canonicalJson } from '../../src/services/backup';
import {
  applyPackUpdate,
  checkForUpdates,
  lastAppliedSummary,
  lastCheckState,
  lastDiffState,
  PATCH_REVISION_KEY,
} from '../../src/services/patchWatch';
import { readSnapshot, restoreSnapshot } from '../../src/services/snapshots';
import {
  cardStatesRepo,
  cardsRepo,
  conflictsRepo,
  metaRepo,
  packsRepo,
  problemMovesRepo,
  resetDbForTests,
  snapshotsRepo,
} from '../../src/data/repos';
import { PACK_VERSION } from '../../src/data/packs';
import type { Move, PackRecord } from '../../src/data/schemas';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

function fixture(name: string): string {
  const fromRoot = resolve(process.cwd(), 'tests/fixtures/patch', name);
  const path = existsSync(fromRoot)
    ? fromRoot
    : fileURLToPath(new URL(`../fixtures/patch/${name}`, import.meta.url));
  return readFileSync(path, 'utf8');
}

const oldPack = JSON.parse(fixture('old-pack.json')) as Move[];
const newPack = JSON.parse(fixture('new-pack.json')) as Move[];
const goldenDiff = JSON.parse(fixture('golden-diff.json')) as PackDiff;

const WavuFixture = (): { live: string; revisions: string } => {
  const live = readFileSync(resolve(process.cwd(), 'tests/fixtures/wavu/cargo-live-shape.json'), 'utf8');
  const revisions = readFileSync(resolve(process.cwd(), 'tests/fixtures/wavu/cargo-revisions.json'), 'utf8');
  return { live, revisions };
};

function wavuFetcher(serve: (url: string) => string, requests: string[] = []): FetchLike {
  return async (url) => {
    requests.push(url);
    return { ok: true, status: 200, text: async () => serve(url) };
  };
}

async function seedStoredPack(moves: Move[], sourceRev = '62125'): Promise<void> {
  const record: PackRecord = {
    id: 'moves-3.02.02-62125',
    kind: 'moves',
    patch: '3.02.02',
    version: PACK_VERSION,
    updatedAt: '2026-10-29T10:00:00.000Z',
    data: moves,
    provenance: { source: 'wavu', sourceRev, patch: '3.02.02', status: 'sourced' },
  };
  await packsRepo.put(record);
}

describe('golden diff (AC-PATCH-2)', () => {
  it('diffs the fixture packs exactly as the golden file', () => {
    const diff = diffPacks(oldPack, newPack);
    expect(diff).toEqual(goldenDiff);
    expect(diff.changed).toEqual([
      { id: 'Yoshimitsu-b+2,2', num: 63, fields: [{ field: 'block', oldValue: '-13', newValue: '-9' }] },
    ]);
    expect(diff.added.map((m) => m.id)).toEqual(['Yoshimitsu-f+2']);
    expect(diff.removed.map((m) => m.id)).toEqual(['Yoshimitsu-1,1']);
  });
});

describe('checkForUpdates (AC-PATCH-1)', () => {
  it('reports up-to-date when the revision matches and nothing changed', async () => {
    const { live, revisions } = WavuFixture();
    const moves = await importMoves(
      wavuFetcher((url) => (url.includes('prop=revisions') ? revisions : url.includes('offset=2') ? '{"cargoquery":[]}' : live)),
      { limit: 2, delayMs: 0 },
    );
    await seedStoredPack(moves, '987654');
    await metaRepo.put({ key: PATCH_REVISION_KEY, value: '987654' });
    const result = await checkForUpdates(
      wavuFetcher((url) => (url.includes('prop=revisions') ? revisions : url.includes('offset=2') ? '{"cargoquery":[]}' : live)),
      '2026-10-29T10:00:00.000Z',
    );
    expect(result.status).toBe('up-to-date');
    expect(result.diff?.changed).toHaveLength(0);
    expect(result.message).toBe('Data is up to date.');
    expect((await lastCheckState())?.status).toBe('up-to-date');
  });

  it('reports update-available with the changed field when a value moves', async () => {
    const { live, revisions } = WavuFixture();
    const mutated = JSON.stringify({
      cargoquery: (JSON.parse(live) as { cargoquery: { title: Record<string, unknown> }[] }).cargoquery.map(
        (row, i) => (i === 0 ? { title: { ...row.title, block: '-5' } } : row),
      ),
    });
    const moves = await importMoves(
      wavuFetcher((url) => (url.includes('prop=revisions') ? revisions : url.includes('offset=2') ? '{"cargoquery":[]}' : live)),
      { limit: 2, delayMs: 0 },
    );
    await seedStoredPack(moves, '987654');
    await metaRepo.put({ key: PATCH_REVISION_KEY, value: '987654' });
    const result = await checkForUpdates(
      wavuFetcher((url) => (url.includes('prop=revisions') ? revisions : url.includes('offset=2') ? '{"cargoquery":[]}' : mutated)),
      '2026-10-29T10:00:00.000Z',
    );
    expect(result.status).toBe('update-available');
    expect(result.diff?.changed).toHaveLength(1);
    // The block change also drops the derived plus-on-block tag.
    expect(result.diff?.changed[0]?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'block', oldValue: '+1', newValue: '-5' }),
      expect.objectContaining({ field: 'tags', oldValue: 'plus-on-block', newValue: '' }),
    ]));
  });

  it('stays calm offline: last known state, retry, never an error page', async () => {
    await seedStoredPack(oldPack, '62125');
    await metaRepo.put({ key: PATCH_REVISION_KEY, value: '62125' });
    const failing: FetchLike = async () => {
      throw new Error('fetch failed');
    };
    const result = await checkForUpdates(failing, '2026-10-29T10:00:00.000Z');
    expect(result.status).toBe('offline');
    expect(result.moves).toBeNull();
    expect(result.diff).toBeNull();
    expect(result.message).toBe('Offline. Showing the last known state.');
    expect(result.previousRevision).toBe('62125');
    const state = await lastCheckState();
    expect(state?.status).toBe('offline');
    expect(state?.checkedAt).toBe('2026-10-29T10:00:00.000Z');
  });
});

describe('applyPackUpdate (AC-PATCH-3/4, G6)', () => {
  const today = '2026-10-29';
  const at = '2026-10-29T10:00:00.000Z';

  async function seedApplyState(): Promise<PackDiff> {
    await seedStoredPack(oldPack, '62125');
    await cardsRepo.put({
      id: 'card-b22', deck: 'Punish', front: 'b+2,2 on block?', back: '-9',
      refs: ['Yoshimitsu-b+2,2'], createdAt: at,
    });
    await cardStatesRepo.put({
      cardId: 'card-b22', reps: 2, lapses: 0, ease: 2.5, intervalDays: 3,
      due: '2026-11-05', history: [],
    });
    await problemMovesRepo.put({
      id: 'pm-removed', character: 'Yoshimitsu', moveId: 'Yoshimitsu-1,1',
      input: '1,1', description: 'Trouble punishing 1,1',
      answer: { kind: 'punish', detail: 'Flash' }, verified: false, createdFrom: 'manual',
    });
    return diffPacks(oldPack, newPack);
  }

  it('snapshots first, flags the card due, queues one verify task, resets provenance, banners the change', async () => {
    const diff = await seedApplyState();
    const summary = await applyPackUpdate(newPack, diff, '62126', '3.02.02', today, at);
    expect(summary.changedCount).toBe(1);
    expect(summary.addedCount).toBe(1);
    expect(summary.removedCount).toBe(1);
    expect(summary.cardsDueToday).toEqual(['card-b22']);
    expect(summary.verifyTasks).toBe(1);
    expect(summary.bannerText).toContain('b+2,2');
    expect(summary.bannerText).toContain('-13 → -9');

    const snaps = await snapshotsRepo.all();
    expect(snaps.some((s) => s.reason === 'pre-pack-update')).toBe(true);

    const state = await cardStatesRepo.get('card-b22');
    expect(state?.due).toBe(today);

    const conflict = await conflictsRepo.get('patch-verify-Yoshimitsu-b+2,2');
    expect(conflict?.status).toBe('open');
    expect(conflict?.values).toEqual([
      { source: 'previous', value: '-13' },
      { source: 'patch', value: '-9' },
    ]);

    const stored = await packsRepo.getByKind('moves');
    const changed = (stored?.data as Move[]).find((m) => m.id === 'Yoshimitsu-b+2,2');
    expect(changed?.block).toBe('-9');
    expect(changed?.provenance.status).toBe('sourced');
    expect(stored?.provenance.sourceRev).toBe('62126');

    const problem = await problemMovesRepo.get('pm-removed');
    expect(problem?.removedFromData).toBe(true);

    const last = await lastAppliedSummary();
    expect(last?.bannerText).toBe(summary.bannerText);
    const diffState = await lastDiffState();
    expect(diffState?.changed).toHaveLength(1);
  });

  it('restoring the pre-update snapshot returns the exact prior pack (hash match)', async () => {
    const diff = await seedApplyState();
    const beforeJson = canonicalJson((await packsRepo.getByKind('moves'))?.data);
    const beforeHash = (await packsRepo.getByKind('moves'))?.provenance.sourceRev;
    await applyPackUpdate(newPack, diff, '62126', '3.02.02', today, at);
    expect(canonicalJson((await packsRepo.getByKind('moves'))?.data)).not.toBe(beforeJson);
    const snap = (await snapshotsRepo.all()).find((s) => s.reason === 'pre-pack-update');
    expect(snap).toBeDefined();
    await restoreSnapshot(snap?.id ?? '', '2026-10-29T11:00:00.000Z');
    expect(canonicalJson((await packsRepo.getByKind('moves'))?.data)).toBe(beforeJson);
    expect((await packsRepo.getByKind('moves'))?.provenance.sourceRev).toBe(beforeHash);
    // The pre-restore snapshot preserved the applied state too.
    const preRestore = (await snapshotsRepo.all()).find((s) => s.at === '2026-10-29T11:00:00.000Z');
    expect(preRestore).toBeDefined();
    const prePayload = await readSnapshot(preRestore?.id ?? '');
    expect(canonicalJson((prePayload.backup.tables.packs as PackRecord[])[0]?.data)).not.toBe(beforeJson);
  });
});
