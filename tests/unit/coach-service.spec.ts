// P9 — Coach service: context budget/truncation, rate limit, ask flow
// (mock/none/fallback), answer checking, Next-action enforcement, weekly
// review from live data. AC-COACH-1/2/4/5 (service level; e2e in coach.spec.ts).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile, defaultSettings, seedIfEmpty } from '../../src/data/bootstrap';
import { estimateTokens } from '../../src/domain/coach/context';
import { checkAnswer } from '../../src/domain/coach/checker';
import {
  coachMessagesRepo,
  errorsRepo,
  masteryRepo,
  matchSetsRepo,
  profileRepo,
  resetDbForTests,
  sessionsRepo,
  setsRepo,
  settingsRepo,
  stageStatusRepo,
} from '../../src/data/repos';
import type { MatchSet, Profile, Settings } from '../../src/data/schemas';
import {
  askCoach,
  buildCoachContext,
  buildCoachContextState,
  coachRequestStamps,
  enforceSingleNextAction,
  providerFromSettings,
  recordCoachRequest,
  withinRateLimit,
  weeklyReviewText,
} from '../../src/services/coach';

const NOW = '2026-10-29T21:00:00.000Z';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

function tallies(overrides: Partial<MatchSet['tallies']> = {}): MatchSet['tallies'] {
  return {
    missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
    hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
    heatConverted: 0, heatWasted: 0, okiConverted: 0,
    ...overrides,
  };
}

async function seedBase(provider: Settings['aiProvider'] = 'none'): Promise<{ profile: Profile; settings: Settings }> {
  const profile = await profileRepo.put(defaultProfile(NOW));
  const settings = await settingsRepo.put({ ...defaultSettings(), aiProvider: provider });
  return { profile, settings };
}

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

describe('context bundle (§8.3)', () => {
  it('stays under 6000 tokens with two weeks of sessions, dropping the oldest first', async () => {
    const { profile, settings } = await seedBase();
    for (let d = 0; d < 14; d += 1) {
      const day = `2026-10-${String(16 + d).padStart(2, '0')}`;
      await sessionsRepo.put({
        id: `sess-${d}`, kind: 'plan', startedAt: `${day}T19:00:00.000Z`, endedAt: `${day}T19:30:00.000Z`,
        status: 'done', plannedMinutes: 30, blocks: [], currentBlock: 0, pausedMs: 0,
      });
      for (let k = 0; k < 6; k += 1) {
        await setsRepo.put({
          id: `set-${d}-${k}`, sessionId: `sess-${d}`, drillId: 'd1-punish-ladder',
          nodeId: 'n1-punish', at: `${day}T19:1${k}:00.000Z`, day, reps: 10, successes: 8,
        });
      }
    }
    const context = await buildCoachContext('how is my punish?', { profile, settings, nowIso: NOW });
    expect(estimateTokens(context)).toBeLessThanOrEqual(6000);
    expect(context).toContain('2026-10-29');
    const state = await buildCoachContextState('b+2,2 on block', { profile, settings, nowIso: NOW });
    expect(state.codex.length).toBeLessThanOrEqual(12);
    expect(state.codex.some((e) => e.input === 'b+2,2')).toBe(true);
  });

  it('retrieves by alias and never exceeds 12 entries', async () => {
    const { profile, settings } = await seedBase();
    const state = await buildCoachContextState('flash punish', { profile, settings, nowIso: NOW });
    expect(state.codex.length).toBeLessThanOrEqual(12);
    expect(state.codex.some((e) => e.input === '1+4')).toBe(true);
  });
});

describe('rate limit (§8.6)', () => {
  it('blocks the 21st request in an hour and allows after the window', async () => {
    const settings = defaultSettings();
    const nowMs = Date.parse(NOW);
    const stamps = Array.from({ length: 20 }, (_, i) => nowMs - i * 60000);
    expect(withinRateLimit(settings, nowMs, stamps)).toBe(false);
    expect(withinRateLimit(settings, nowMs, stamps.slice(1))).toBe(true);
    expect(withinRateLimit(settings, nowMs, stamps.map((s) => s - 3600_000))).toBe(true);
    expect(withinRateLimit({ ...settings, aiRequestsPerHour: 0 }, nowMs, stamps)).toBe(true);
  });

  it('records timestamps through the storage adapter', async () => {
    const storage = memoryStorage();
    const nowMs = Date.parse(NOW);
    recordCoachRequest(storage, nowMs);
    recordCoachRequest(storage, nowMs + 1000);
    const settings = defaultSettings();
    expect(coachRequestStamps(storage)).toEqual([nowMs, nowMs + 1000]);
    expect(withinRateLimit(settings, nowMs + 1000, coachRequestStamps(storage))).toBe(true);
  });
});

describe('askCoach', () => {
  it('AC-COACH-2: mock provider round-trips and ends with exactly one Next action line', async () => {
    const { profile, settings } = await seedBase('mock');
    const result = await askCoach('what should I drill?', { profile, settings, nowIso: NOW, storage: memoryStorage() });
    expect(result.source).toBe('ai');
    expect(result.text).toMatch(/Next action:/);
    expect(result.text.match(/^Next action:/gm)?.length).toBe(1);
    expect(result.text.trimEnd().split('\n').pop()).toMatch(/^Next action:/);
    const messages = await coachMessagesRepo.allByThread('ask');
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[1]?.role).toBe('coach');
  });

  it('AC-COACH-1: no provider answers offline from the rules coach', async () => {
    const { profile, settings } = await seedBase('none');
    const result = await askCoach('how was my week?', { profile, settings, nowIso: NOW, storage: memoryStorage() });
    expect(result.source).toBe('rules');
    expect(result.text).toContain('Week of');
    expect(result.text.match(/^Next action:/gm)?.length).toBe(1);
  });

  it('AC-COACH-2: a provider error falls back with a visible notice', async () => {
    const { profile, settings } = await seedBase('openai-compatible');
    const failingFetch = () => Promise.reject(new Error('Failed to fetch'));
    const result = await askCoach('help?', {
      profile,
      settings: { ...settings, aiApiKey: 'sk-test', aiBaseUrl: 'https://example.invalid/v1', aiModel: 'test-model' },
      nowIso: NOW,
      fetchImpl: failingFetch as unknown as typeof fetch,
      storage: memoryStorage(),
    });
    expect(result.source).toBe('fallback');
    expect(result.fallbackNotice).toContain('AI coach unavailable');
    expect(result.text).toContain('Here is the built-in review.');
    expect(result.text.match(/^Next action:/gm)?.length).toBe(1);
  });

  it('missing key configuration falls back without ever exposing a key', async () => {
    const { profile, settings } = await seedBase('anthropic');
    const result = await askCoach('help?', { profile, settings, nowIso: NOW, storage: memoryStorage() });
    expect(result.source).toBe('fallback');
    expect(result.fallbackNotice).toContain('API key is not set');
  });

  it('rate-limit exhaustion falls back with the limit notice', async () => {
    const { profile, settings } = await seedBase('mock');
    const storage = memoryStorage();
    const nowMs = Date.parse(NOW);
    for (let i = 0; i < 20; i += 1) recordCoachRequest(storage, nowMs - i * 1000);
    const result = await askCoach('help?', { profile, settings, nowIso: NOW, storage });
    expect(result.source).toBe('fallback');
    expect(result.fallbackNotice).toContain('request limit reached');
  });

  it('providerFromSettings rejects missing model/base URL with key-free errors', async () => {
    const settings = defaultSettings();
    expect(() => providerFromSettings({ ...settings, aiProvider: 'openai-compatible', aiApiKey: 'k' })).toThrow('base URL');
    expect(() => providerFromSettings({ ...settings, aiProvider: 'openai-compatible', aiApiKey: 'k', aiBaseUrl: 'https://x' })).toThrow('model');
    expect(() => providerFromSettings({ ...settings, aiProvider: 'none' })).toThrow('no provider');
  });
});

describe('answer checking (§8.6, AC-COACH-4/5)', () => {
  it('flags a frame value absent from the context and leaves present values alone', async () => {
    const context = 'Flash (1+4) is i11. b+2,2 is -14 on block.';
    const checked = checkAnswer('Use Flash, it is i11, or punish with i15.', context, 'Drill Flash.');
    expect(checked.flagged).toEqual(['i15']);
    expect(checked.text).toContain('i15 (check this number)');
    expect(checked.text).not.toContain('i11 (check this number)');
  });

  it('appends a Next action line when missing and keeps exactly one', async () => {
    const checked = checkAnswer('Good work.', 'No frames here.', 'Drill the BnB.');
    expect(checked.hadNextAction).toBe(false);
    expect(checked.text).toContain('Next action: Drill the BnB.');
    const doubled = enforceSingleNextAction('First.\nNext action: One.\nMiddle.\nNext action: Two.');
    expect(doubled.match(/^Next action:/gm)?.length).toBe(1);
    expect(doubled.trimEnd().endsWith('Next action: Two.')).toBe(true);
    expect(enforceSingleNextAction('No action line.')).toBe('No action line.');
  });

  it('logs flagged answers to the error buffer with tokens only', async () => {
    const { profile, settings } = await seedBase('mock');
    // The mock provider never invents frame values, so force the flag path by
    // asking through a fetch-backed provider whose reply quotes an absent value.
    const fakeFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Punish with i99.\nNext action: Drill.' } }] }), { status: 200 });
    const result = await askCoach('punish?', {
      profile,
      settings: { ...settings, aiProvider: 'openai-compatible', aiApiKey: 'k', aiBaseUrl: 'https://x.test', aiModel: 'm' },
      nowIso: NOW,
      fetchImpl: fakeFetch as unknown as typeof fetch,
      storage: memoryStorage(),
    });
    expect(result.flagged).toContain('i99');
    const errors = await errorsRepo.all();
    expect(errors.some((e) => e.where === 'coach.checkAnswer' && e.message.includes('i99'))).toBe(true);
  });
});

describe('weekly review from live data', () => {
  it('reports an empty week honestly', async () => {
    const { profile, settings } = await seedBase();
    const text = await weeklyReviewText(NOW, { profile, settings });
    expect(text).toContain('Week of');
    expect(text).toContain('0 sessions');
    expect(text).toContain('no games logged');
    expect(text.match(/^Next action:/gm)?.length).toBe(1);
  });

  it('lists a stage passed inside the window as moved up', async () => {
    const { profile, settings } = await seedBase();
    await stageStatusRepo.put({ stageId: 'stage-0', state: 'passed', passedAt: '2026-10-28T10:00:00.000Z', viaPlacement: false });
    await masteryRepo.put({
      nodeId: 'n0-controls', K: 1, E: 1, A: 1, score: 0.84, state: 'solid', placed: false,
      evidenceDays: ['2026-10-28'], updatedAt: '2026-10-28T10:00:00.000Z',
    });
    const text = await weeklyReviewText(NOW, { profile, settings });
    expect(text).toContain('Solid (0.84 to 0.84)');
  });

  it('counts games and missed punishes from logged match sets', async () => {
    const { profile, settings } = await seedBase();
    const set: MatchSet = {
      id: 'm1', at: '2026-10-28T20:00:00.000Z', day: '2026-10-28', mode: 'ranked',
      opponentCharacter: 'Kazuya', games: 10, wins: 4,
      tallies: tallies({ missedPunishes: 19 }), beatBy: [], tags: [],
    };
    await matchSetsRepo.put(set);
    const text = await weeklyReviewText(NOW, { profile, settings });
    expect(text).toContain('10 games, 1.9 missed punishes per game');
  });
});

describe('seedIfEmpty guard', () => {
  it('seeds a fresh database (smoke for the coach deps)', async () => {
    const seeded = await seedIfEmpty();
    expect(seeded.profile.displayName.length).toBeGreaterThan(0);
    expect(seeded.settings.aiProvider).toBe('none');
  });
});
