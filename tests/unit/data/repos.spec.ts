// §6.3 — Dexie repository tests using fake-indexeddb.
// Guard: if fake-indexeddb cannot be imported at runtime, every test in this
// file is skipped instead of failing, so the suite stays green on a scaffold
// without the dependency.
import { describe, expect, it } from 'vitest';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
if (fakeAvailable) {
  const globals = globalThis as Record<string, unknown>;
  globals['indexedDB'] = fakeModule?.['indexedDB'];
  globals['IDBKeyRange'] = fakeModule?.['IDBKeyRange'];
}

// The database and repositories are imported only when fake-indexeddb is present,
// so a missing dependency cannot break module loading for the rest of the suite.
const repos = fakeAvailable
  ? await import('../../../src/data/repos/index')
  : null;
const dbModule = fakeAvailable
  ? await import('../../../src/data/db')
  : null;

describe.skipIf(!fakeAvailable)('Dexie repositories', () => {
  it('profileRepo round-trips the singleton profile and validates on put', async () => {
    if (repos === null || dbModule === null) return;
    await dbModule.resetDbForTests();
    expect(await repos.profileRepo.get()).toBeUndefined();
    const profile = {
      id: 'me' as const,
      displayName: 'Sagar',
      platform: 'ps5' as const,
      controller: 'DualSense',
      glyphMode: 'playstation' as const,
      targetRank: 'Tekken King',
      weeklyMinutes: 300,
      sessionMinutes: 30,
      preferredDays: [1, 3, 5],
      dayBoundary: '04:00',
      timezone: 'America/Chicago',
      createdAt: '2026-10-29T05:52:00Z',
    };
    await repos.profileRepo.put(profile);
    expect(await repos.profileRepo.get()).toEqual(profile);
    expect(await repos.profileRepo.all()).toHaveLength(1);
    await expect(repos.profileRepo.put({ ...profile, platform: 'atari' as never })).rejects.toThrow();
    await repos.profileRepo.remove();
    expect(await repos.profileRepo.get()).toBeUndefined();
  });

  it('setsRepo queries by session, drill, node and day', async () => {
    if (repos === null || dbModule === null) return;
    await dbModule.resetDbForTests();
    const base = {
      drillId: 'd1-punish-ladder',
      nodeId: 'n1-punish',
      at: '2026-10-29T05:52:00Z',
      day: '2026-10-29',
      reps: 10,
      successes: 8,
    };
    await repos.setsRepo.put({ id: 'set-1', sessionId: 'sess-1', ...base });
    await repos.setsRepo.put({ id: 'set-2', sessionId: 'sess-1', ...base, successes: 9 });
    await repos.setsRepo.put({ id: 'set-3', sessionId: 'sess-2', ...base, day: '2026-10-30' });
    expect((await repos.setsRepo.allBySession('sess-1')).map((s) => s.id)).toEqual(['set-1', 'set-2']);
    expect(await repos.setsRepo.allByDrill('d1-punish-ladder')).toHaveLength(3);
    expect(await repos.setsRepo.allByNode('n1-punish')).toHaveLength(3);
    expect(await repos.setsRepo.allByDay('2026-10-30')).toHaveLength(1);
    expect(await repos.setsRepo.getById('set-2')).toMatchObject({ successes: 9 });
  });

  it('sessionsRepo stores blocks on the session row', async () => {
    if (repos === null || dbModule === null) return;
    await dbModule.resetDbForTests();
    const session = {
      id: 'sess-1',
      kind: 'plan' as const,
      startedAt: '2026-10-29T05:52:00Z',
      status: 'active' as const,
      plannedMinutes: 30,
      blocks: [{ id: 'b1', kind: 'drill' as const, drillId: 'd1-punish-ladder', minutes: 10, reason: 'Weakness: punishes' }],
      currentBlock: 0,
      pausedMs: 0,
    };
    await repos.sessionsRepo.put(session);
    expect(await repos.sessionsRepo.get('sess-1')).toEqual(session);
    expect(await repos.sessionsRepo.allByStatus('active')).toHaveLength(1);
  });

  it('cardsRepo and cardStatesRepo round-trip cards and due states', async () => {
    if (repos === null || dbModule === null) return;
    await dbModule.resetDbForTests();
    await repos.cardsRepo.put({
      id: 'card-1', deck: 'Punish ladder', front: '-14 standing: best punish?',
      back: 'b+2,2 (33, Heat Engager)', refs: ['Yoshimitsu-b+2,2'], createdAt: '2026-10-29T05:52:00Z',
    });
    await repos.cardStatesRepo.put({
      cardId: 'card-1', reps: 1, lapses: 0, ease: 2.5, intervalDays: 1, due: '2026-10-30', history: [],
    });
    expect(await repos.cardsRepo.allByDeck('Punish ladder')).toHaveLength(1);
    expect(await repos.cardStatesRepo.allDue('2026-10-30')).toHaveLength(1);
    expect(await repos.cardStatesRepo.allDue('2026-10-29')).toHaveLength(0);
  });

  it('masteryRepo and errorsRepo round-trip engine state and the error ring buffer', async () => {
    if (repos === null || dbModule === null) return;
    await dbModule.resetDbForTests();
    await repos.masteryRepo.put({
      nodeId: 'n1-punish', K: 0.8, E: 0.7, A: null, score: 72, state: 'practicing',
      placed: false, evidenceDays: ['2026-10-29'], updatedAt: '2026-10-29T05:52:00Z',
    });
    expect(await repos.masteryRepo.allByState('practicing')).toHaveLength(1);
    await repos.errorsRepo.put({
      id: 'err-1', at: '2026-10-29T05:52:00Z', where: 'import', message: 'Wavu unreachable',
    });
    expect(await repos.errorsRepo.latest(50)).toHaveLength(1);
    expect(await repos.errorsRepo.get('err-1')).toMatchObject({ where: 'import' });
  });

  it('resetDbForTests refuses to run outside a test environment', async () => {
    if (dbModule === null) return;
    const originalNodeEnv = process.env['NODE_ENV'];
    const originalVitest = process.env['VITEST'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['VITEST'];
    try {
      await expect(dbModule.resetDbForTests()).rejects.toThrow(/test environment/);
    } finally {
      if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = originalNodeEnv;
      if (originalVitest === undefined) delete process.env['VITEST'];
      else process.env['VITEST'] = originalVitest;
    }
  });
});
