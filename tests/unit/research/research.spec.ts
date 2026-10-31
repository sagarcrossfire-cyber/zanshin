// Release 1.3.0 — research on the app side: the pure helpers, the intel
// client, the ZANSHIN coach provider, and the research service writing
// notes to the research table. Every call to the site is a mocked fetch;
// nothing here reaches the network.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZanshinProvider } from '../../../src/domain/coach/providers/zanshin';
import { CoachUnavailable } from '../../../src/domain/coach/providers';
import {
  checkResearch,
  citationHost,
  detectCharacter,
  isRenderableCitation,
  patchChanges,
  recordLine,
  researchContext,
  researchNoteId,
} from '../../../src/domain/intel/research';
import { intelModelOptions, isIntelModel } from '../../../src/domain/intel/models';
import { matchSetsRepo, problemMovesRepo, researchRepo, resetDbForTests, settingsRepo } from '../../../src/data/repos';
import { defaultSettings } from '../../../src/data/bootstrap';
import type { MatchSet, ResearchNote } from '../../../src/data/schemas';
import { exportBackup, importBackup } from '../../../src/services/backup';
import { providerFromSettings, testConnection } from '../../../src/services/coach';
import { IntelError, formatSpend, intelHealth, matchupPrimer, patchBrief, research } from '../../../src/services/intel';
import { fetchBrief, fetchPrimer, lookUp, saveNote, storedBrief, storedPrimer } from '../../../src/services/research';

const NOW = '2026-10-31T18:00:00.000Z';

function matchSet(overrides: Partial<MatchSet>): MatchSet {
  return {
    at: NOW, beatBy: [], day: '2026-10-31', games: 5, id: 'm1', mode: 'ranked', opponentCharacter: 'Jin',
    tags: [], tallies: {
      flashBlocked: 0, flashHit: 0, flashWhiffed: 0, heatConverted: 0, heatWasted: 0, hitWhileMinus: 0,
      lowsBlocked: 0, lowsEaten: 0, missedPunishes: 0, okiConverted: 0, spinEscaped: 0, spinPunished: 0,
      throwsBroken: 0, throwsMissed: 0,
    }, wins: 2, ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

function fetchMock(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    return responder(String(input), init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const RESEARCH_BODY = {
  citations: [{ date: '2026-09-01', id: '1', title: 'Jin guide', url: 'https://wavu.wiki/t/Jin' }, { id: '2', title: 'bad', url: 'ftp://nope' }],
  model: 'perplexity/sonar',
  text: 'Duck the second hit [1]. It is reported -13 on block.<script>x</script>',
  usage: { capUsd: 3, costUsd: 0.01, inputTokens: 500, outputTokens: 120, todayUsd: 0.42 },
};

describe('research helpers (domain)', () => {
  it('checkResearch strips HTML and lists frame-like numbers, not the buttons in move inputs', () => {
    const checked = checkResearch('Reported -13 on block, i15 startup.<b>x</b>');
    expect(checked.text).toBe('Reported -13 on block, i15 startup.x');
    expect(checked.frameTokens).toEqual(['-13', 'i15']);
    expect(checkResearch('Step f,f+2 and launch 1+4; the sweep is reported −23 on block and d/f+1 leaves you +4 on hit (−1 on block).').frameTokens.sort())
      .toEqual(['+4', '−1', '−23']);
    expect(checkResearch('Use d/f+1, 1+4 and b+2,2 — no numbers here.').frameTokens).toEqual([]);
  });

  it('detects the roster character a question names, longest match first', () => {
    const roster = [{ name: 'Jin' }, { name: 'Devil Jin' }, { name: 'Kazuya' }];
    expect(detectCharacter('How do I beat Devil Jin?', roster)).toBe('Devil Jin');
    expect(detectCharacter('jin pressure?', roster)).toBe('Jin');
    expect(detectCharacter('What does Yoshimitsu do in Heat?', roster)).toBeUndefined();
    expect(detectCharacter('kazuyas ewgf', roster)).toBeUndefined();
  });

  it('builds the record line and the research context from app data', () => {
    const sets = [matchSet({ beatBy: ['f,f+2', 'd/f+1'], id: 'm1' }), matchSet({ beatBy: ['f,f+2'], games: 3, id: 'm2', wins: 3 })];
    expect(recordLine('Jin', sets)).toBe("Sagar's record vs Jin: 5-3 over 8 games (2 sets). Moves that beat him most: f,f+2, d/f+1.");
    expect(recordLine('Paul', sets)).toBeUndefined();
    const ctx = researchContext({ matchSets: sets, problemMoves: [], question: 'How do I stop Jin f,f+2?', roster: [{ name: 'Jin' }] });
    expect(ctx.character).toBe('Jin');
    expect(ctx.context).toContain("record vs Jin: 5-3");
    expect(researchContext({ matchSets: [], problemMoves: [], question: 'general', roster: [] })).toEqual({ character: undefined, context: undefined });
  });

  it('shapes a Patch Watch diff for the brief route', () => {
    const changes = patchChanges(
      [{ fields: [{ field: 'block', newValue: '-21', oldValue: '-20' }, { field: 'damage', newValue: 25, oldValue: 23 }], id: 'Yoshimitsu-1+4' }, { fields: [{ field: 'startup', newValue: 'i12', oldValue: 'i11' }], id: 'ghost' }],
      [{ id: 'Yoshimitsu-1+4', input: '1+4', name: 'Soul Stealer' }],
    );
    expect(changes).toEqual([
      { after: '-21', before: '-20', field: 'block', input: '1+4', moveId: 'Yoshimitsu-1+4', name: 'Soul Stealer' },
      { after: '25', before: '23', field: 'damage', input: '1+4', moveId: 'Yoshimitsu-1+4', name: 'Soul Stealer' },
      { after: 'i12', before: 'i11', field: 'startup', input: 'ghost', moveId: 'ghost' },
    ]);
  });

  it('ids, hosts and renderable citations', () => {
    expect(researchNoteId('answer', NOW, 'character:Devil Jin')).toBe(`research-answer-${Date.parse(NOW)}-character:Devil_Jin`);
    expect(citationHost({ url: 'https://www.tekken.com/news/x' })).toBe('tekken.com');
    expect(citationHost({ url: 'not a url' })).toBe('not a url');
    expect(isRenderableCitation({ url: 'https://wavu.wiki/t/Jin' })).toBe(true);
    expect(isRenderableCitation({ url: 'javascript:alert(1)' })).toBe(false);
    expect(isIntelModel('perplexity/sonar')).toBe(true);
    expect(isIntelModel('openai/gpt-99')).toBe(false);
    expect(intelModelOptions().map((option) => option.value)).toContain('anthropic/claude-haiku-5-5');
    expect(formatSpend(0.4, 3)).toBe('$0.40 of $3.00 today');
  });
});

describe('intel client', () => {
  it('research posts the question and parses citations, usage and model', async () => {
    const { calls, fetchImpl } = fetchMock(() => jsonResponse(RESEARCH_BODY));
    const answer = await research({ context: 'ctx', question: 'Q', recency: 'year' }, { fetchImpl });
    expect(calls[0]?.url).toBe('/.netlify/functions/intel/research');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ context: 'ctx', question: 'Q', recency: 'year' });
    expect(answer.citations).toHaveLength(2);
    expect(answer.usage).toEqual({ capUsd: 3, costUsd: 0.01, inputTokens: 500, outputTokens: 120, todayUsd: 0.42 });
    expect(answer.model).toBe('perplexity/sonar');
  });

  it('surfaces the server error text with its status', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse({ capUsd: 3, error: 'Daily intel budget reached ($3.00 of $3.00). Try again tomorrow.', todayUsd: 3 }, 429));
    const error = await research({ question: 'Q' }, { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntelError);
    expect((error as IntelError).capReached).toBe(true);
    expect((error as IntelError).message).toMatch(/budget reached/);
    const { fetchImpl: noKey } = fetchMock(() => jsonResponse({ error: 'no key' }, 503));
    const missing = await intelHealth({ fetchImpl: noKey }).catch((e: unknown) => e);
    expect((missing as IntelError).notConfigured).toBe(true);
  });

  it('times out and reports a dead connection in words', async () => {
    const slow = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const late = await research({ question: 'Q' }, { fetchImpl: slow, timeoutMs: 15 }).catch((e: unknown) => e);
    expect((late as IntelError).status).toBe(504);
    expect((late as IntelError).message).toMatch(/too long/);
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const offline = await research({ question: 'Q' }, { fetchImpl: down }).catch((e: unknown) => e);
    expect((offline as IntelError).message).toMatch(/connection/);
  });

  it('primer and patch brief routes encode and parse their shapes', async () => {
    const { calls, fetchImpl } = fetchMock((url) => jsonResponse(url.includes('primer')
      ? { ...RESEARCH_BODY, cached: true, character: 'Devil Jin', generatedAt: NOW, stale: true }
      : { ...RESEARCH_BODY, cached: false, generatedAt: NOW, revision: '123' }));
    const primer = await matchupPrimer('Devil Jin', true, { fetchImpl });
    expect(calls[0]?.url).toBe('/.netlify/functions/intel/primer/Devil%20Jin?refresh=1');
    expect(primer).toMatchObject({ cached: true, character: 'Devil Jin', stale: true });
    const brief = await patchBrief({ changes: [], revision: '123' }, { fetchImpl });
    expect(brief).toMatchObject({ cached: false, revision: '123' });
  });
});

describe('ZANSHIN coach provider', () => {
  it('posts the system prompt, messages and model to the site and keeps the spend', async () => {
    const { calls, fetchImpl } = fetchMock(() => jsonResponse({ model: 'anthropic/claude-sonnet-5-5', text: 'Do it.\n\nNext action: Lab.', usage: { capUsd: 3, costUsd: 0.02, todayUsd: 0.5 } }));
    const provider = new ZanshinProvider({ fetchImpl, model: 'anthropic/claude-sonnet-5-5' });
    const response = await provider.send({ maxTokens: 600, messages: [{ content: 'Q', role: 'user' }], signal: new AbortController().signal, system: 'SYS' });
    expect(response.text).toBe('Do it.\n\nNext action: Lab.');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ maxTokens: 600, messages: [{ content: 'Q', role: 'user' }], model: 'anthropic/claude-sonnet-5-5', system: 'SYS' });
    expect(provider.lastUsage).toEqual({ capUsd: 3, costUsd: 0.02, todayUsd: 0.5 });
    expect(new ZanshinProvider({ model: 'claude-sonnet-5-5' }).model).toBe('anthropic/claude-haiku-5-5');
  });

  it('turns server errors into CoachUnavailable with the server’s words', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse({ error: 'Daily intel budget reached ($3.00 of $3.00).' }, 429));
    const provider = new ZanshinProvider({ fetchImpl });
    await expect(provider.send({ maxTokens: 600, messages: [{ content: 'Q', role: 'user' }], signal: new AbortController().signal, system: 'SYS' }))
      .rejects.toThrow(/budget reached/);
    const { fetchImpl: empty } = fetchMock(() => jsonResponse({ text: '' }));
    await expect(new ZanshinProvider({ fetchImpl: empty }).send({ maxTokens: 600, messages: [{ content: 'Q', role: 'user' }], signal: new AbortController().signal, system: 'SYS' }))
      .rejects.toBeInstanceOf(CoachUnavailable);
  });

  it('providerFromSettings picks it without any key, and Test connection uses the free health route', async () => {
    const settings = { ...defaultSettings(), aiModel: 'perplexity/sonar', aiProvider: 'zanshin' as const };
    const provider = providerFromSettings(settings);
    expect(provider.id).toBe('zanshin');
    expect((provider as ZanshinProvider).model).toBe('perplexity/sonar');
    const { calls, fetchImpl } = fetchMock(() => jsonResponse({ capUsd: 3, keyConfigured: true, ok: true, today: { costUsd: 0.25, requests: 3 } }));
    const result = await testConnection({ fetchImpl, profile: { id: 'me' } as never, settings });
    expect(result).toEqual({ message: 'Connection works. $0.25 of $3.00 today.', ok: true });
    expect(calls[0]?.url).toBe('/.netlify/functions/intel/health');
    const { fetchImpl: noKey } = fetchMock(() => jsonResponse({ capUsd: 3, keyConfigured: false, ok: true, today: { costUsd: 0, requests: 0 } }));
    expect((await testConnection({ fetchImpl: noKey, profile: { id: 'me' } as never, settings })).ok).toBe(false);
  });
});

describe('research service', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('lookUp attaches the record vs the named character, checks the text and makes an unsaved note', async () => {
    await matchSetsRepo.put(matchSet({ beatBy: ['f,f+2'], id: 'm1' }));
    await problemMovesRepo.put({
      answer: { detail: 'duck', kind: 'duck' }, character: 'Jin', createdFrom: 'manual', description: 'x', id: 'p1', input: 'd/f+1', verified: false,
    });
    const { calls, fetchImpl } = fetchMock(() => jsonResponse(RESEARCH_BODY));
    const result = await lookUp('How do I handle Jin f,f+2?', { model: 'perplexity/sonar' }, { client: { fetchImpl }, nowIso: NOW });
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { context: string; model: string };
    expect(sent.model).toBe('perplexity/sonar');
    expect(sent.context).toContain("record vs Jin: 2-3 over 5 games");
    expect(sent.context).toContain('d/f+1 (duck)');
    expect(result.character).toBe('Jin');
    expect(result.note).toMatchObject({ costUsd: 0.01, createdAt: NOW, kind: 'answer', model: 'perplexity/sonar', subjectKey: 'character:Jin' });
    expect(result.note.text).toBe('Duck the second hit [1]. It is reported -13 on block.');
    expect(result.frameTokens).toEqual(['-13']);
    expect(await researchRepo.count()).toBe(0);
    await saveNote(result.note);
    expect(await researchRepo.count()).toBe(1);
    await expect(lookUp('   ', {}, { client: { fetchImpl } })).rejects.toThrow(/question/);
  });

  it('fetchPrimer keeps one note per character, replaced on refresh; storedPrimer reads it back', async () => {
    expect(await storedPrimer('Jin')).toBeNull();
    const { calls, fetchImpl } = fetchMock(() => jsonResponse({ ...RESEARCH_BODY, cached: false, character: 'Jin', generatedAt: NOW, stale: false, text: '**Their plan**\n- Pressure [1]' }));
    const first = await fetchPrimer('Jin', false, { client: { fetchImpl } });
    expect(first.note).toMatchObject({ kind: 'primer', question: 'Yoshimitsu vs Jin', subjectKey: 'character:Jin' });
    expect(first.fromDevice).toBe(false);
    const later = '2026-11-02T10:00:00.000Z';
    const { fetchImpl: refreshed } = fetchMock(() => jsonResponse({ ...RESEARCH_BODY, cached: false, character: 'Jin', generatedAt: later, stale: false, text: 'New primer [1]' }));
    const second = await fetchPrimer('Jin', true, { client: { fetchImpl: refreshed } });
    expect(second.note.id).toBe(first.note.id);
    expect(second.note.createdAt).toBe(later);
    expect(await researchRepo.count()).toBe(1);
    const kept = await storedPrimer('Jin');
    expect(kept?.fromDevice).toBe(true);
    expect(kept?.note.text).toBe('New primer [1]');
    expect(calls[0]?.url).toBe('/.netlify/functions/intel/primer/Jin');
  });

  it('fetchBrief needs changed moves and keeps the brief by revision', async () => {
    await expect(fetchBrief({ changed: [], patch: '3.03', revision: '9' })).rejects.toThrow(/nothing to explain/);
    const { calls, fetchImpl } = fetchMock(() => jsonResponse({ ...RESEARCH_BODY, cached: false, generatedAt: NOW, revision: '9', text: '- 1+4: reported slower [1]' }));
    const brief = await fetchBrief(
      { changed: [{ fields: [{ field: 'block', newValue: '-21', oldValue: '-20' }], id: 'Yoshimitsu-1+4' }], patch: '3.03', revision: '9' },
      false,
      { client: { fetchImpl } },
    );
    const sent = JSON.parse(String(calls[0]?.init?.body)) as { changes: Array<{ input: string }>; revision: string; patch: string };
    expect(sent.revision).toBe('9');
    expect(sent.patch).toBe('3.03');
    expect(sent.changes[0]?.input).toBeTruthy();
    expect(brief.note).toMatchObject({ kind: 'patch', revision: '9', subjectKey: 'patch:9' });
    expect((await storedBrief('9'))?.note.id).toBe(brief.note.id);
    expect(await storedBrief('10')).toBeNull();
  });

  it('research notes travel in backups and the repo validates rows', async () => {
    const note: ResearchNote = {
      citations: [{ id: '1', title: 'T', url: 'https://wavu.wiki/t/Jin' }], createdAt: NOW, id: 'r1', kind: 'answer', model: 'perplexity/sonar',
      question: 'Q', subjectKey: 'character:Jin', text: 'A',
    };
    await researchRepo.put(note);
    await expect(researchRepo.put({ ...note, citations: [{ id: '1', title: 'T', url: 'nope' }] })).rejects.toThrow();
    await settingsRepo.put(defaultSettings());
    const exported = await exportBackup({ includePacks: false, includeSecrets: false });
    expect(exported.tables.research).toEqual([note]);
    await resetDbForTests();
    await importBackup(exported, async () => {});
    expect(await researchRepo.all()).toEqual([note]);
    expect((await researchRepo.latest('answer', 'character:Jin'))?.id).toBe('r1');
    expect(await researchRepo.byKind('primer')).toEqual([]);
    await researchRepo.remove('r1');
    expect(await researchRepo.count()).toBe(0);
  });
});
