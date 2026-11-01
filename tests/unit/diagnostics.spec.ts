// P10 — Diagnostics (§14.2/§14.6): integrity checks list orphans, repair
// stale sessions and recompute a wrong mastery sample (AC-DIAG-1); the
// self-test reports pass/fail per item on a seeded DB with a stubbed Wavu
// check, and reports (never throws on) an unreachable Wavu.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile, defaultSettings } from '../../src/data/bootstrap';
import { loadCurriculum } from '../../src/data/packs';
import {
  recentErrors,
  runIntegrityChecks,
  runSelfTest,
  validateAllPacks,
} from '../../src/services/diagnostics';
import {
  cardStatesRepo,
  errorsRepo,
  masteryRepo,
  resetDbForTests,
  sessionsRepo,
  setsRepo,
} from '../../src/data/repos';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

const NOW = '2026-10-29T10:00:00.000Z';

describe('validateAllPacks', () => {
  it('validates all nine bundled packs', () => {
    const report = validateAllPacks();
    expect(report).toHaveLength(9);
    expect(report.every((p) => p.valid)).toBe(true);
    expect(report.find((p) => p.name === 'moves.yoshimitsu')?.detail).toContain('319 record(s)');
  });
});

describe('runIntegrityChecks (AC-DIAG-1)', () => {
  it('passes on an empty DB with no orphans and no repairs', async () => {
    const report = await runIntegrityChecks();
    // Seven §14.2 checks, Amendment 01B's media check, and 2.0's stage-lock repair.
    expect(report.checks).toHaveLength(9);
    expect(report.checks.map((c) => c.id)).toContain('media');
    expect(report.checks.every((c) => c.passed)).toBe(true);
    expect(report.orphans).toEqual([]);
    expect(report.repaired).toEqual([]);
    expect(report.clockWarning).toBeNull();
  });

  it('lists orphans, abandons stale sessions, and recomputes a wrong mastery row', async () => {
    await setsRepo.put({
      id: 'set-orphan', drillId: 'nope-drill', nodeId: 'n0-baseline',
      at: NOW, day: '2026-10-29', reps: 10, successes: 5,
    });
    await cardStatesRepo.put({
      cardId: 'ghost-card', reps: 0, lapses: 0, ease: 2.5, intervalDays: 0,
      due: '2026-10-29', history: [],
    });
    const staleStartedAt = new Date(Date.now() - 13 * 3600_000).toISOString();
    await sessionsRepo.put({
      id: 'sess-stale', kind: 'plan', startedAt: staleStartedAt, status: 'active',
      plannedMinutes: 30, blocks: [], currentBlock: 0, pausedMs: 0,
    });
    const node = loadCurriculum().nodes[0];
    expect(node).toBeDefined();
    await masteryRepo.put({
      nodeId: node?.id ?? 'n0-baseline', K: null, E: null, A: null, score: 100,
      state: 'mastered', placed: false, evidenceDays: [], updatedAt: NOW,
    });

    const report = await runIntegrityChecks();
    expect(report.orphans).toHaveLength(2);
    expect(report.orphans.some((o) => o.includes('nope-drill'))).toBe(true);
    expect(report.orphans.some((o) => o.includes('ghost-card'))).toBe(true);
    const stale = await sessionsRepo.get('sess-stale');
    expect(stale?.status).toBe('abandoned');
    expect(report.repaired.some((r) => r.includes('stale active session'))).toBe(true);
    const fixed = await masteryRepo.get(node?.id ?? '');
    expect(fixed?.score).not.toBe(100);
    expect(report.repaired.some((r) => r.includes('mastery row'))).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });
});

describe('runSelfTest (AC-DIAG-1)', () => {
  it('reports every item passing on a seeded DB with a stubbed Wavu check', async () => {
    const results = await runSelfTest({
      profile: defaultProfile(NOW),
      settings: defaultSettings(),
      checkWavu: async () => true,
    });
    expect(results.map((r) => r.id)).toEqual([
      'db-roundtrip', 'integrity', 'packs-tokenize', 'plan-dryrun',
      'service-worker', 'storage', 'wavu',
    ]);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(results.find((r) => r.id === 'packs-tokenize')?.detail).toContain('319 moves tokenized');
    // The test row is cleaned up.
    expect(await errorsRepo.all()).toHaveLength(0);
  });

  it('reports an unreachable Wavu as a failed item, without throwing', async () => {
    const results = await runSelfTest({
      profile: defaultProfile(NOW),
      settings: defaultSettings(),
      checkWavu: async () => false,
    });
    const wavu = results.find((r) => r.id === 'wavu');
    expect(wavu?.passed).toBe(false);
    expect(wavu?.detail).toContain('keeps working offline');
    expect(results.filter((r) => r.id !== 'wavu').every((r) => r.passed)).toBe(true);
  });

  it('omits the Wavu item when no check is supplied', async () => {
    const results = await runSelfTest({
      profile: defaultProfile(NOW),
      settings: defaultSettings(),
    });
    expect(results.some((r) => r.id === 'wavu')).toBe(false);
  });
});

describe('recentErrors', () => {
  it('returns the newest errors first, capped at the limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      await errorsRepo.put({
        id: `e${i}`, at: `2026-10-29T10:0${i}:00.000Z`, where: 'test', message: `boom ${i}`,
      });
    }
    const errors = await recentErrors(2);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toBe('boom 2');
  });
});
