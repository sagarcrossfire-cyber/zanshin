// Release 1.3.0 — the intel function: routing, validation, the daily cap,
// Perplexity response parsing, caching of primers and patch briefs, and the
// shape every client call relies on. Perplexity is a mocked fetch.
import { describe, expect, it, vi } from 'vitest';
import { createIntelHandler, transcript, PRIMER_TTL_MS } from '../../../src/server/intel/handler';
import { parseAgentResponse, AGENT_API_URL } from '../../../src/server/intel/perplexity';
import { memoryStore, recentUsage } from '../../../src/server/intel/store';

const NOW = '2026-10-31T18:00:00.000Z';
const BASE = 'https://zanshin.test/.netlify/functions/intel';

function agentReply(text: string, extra: { results?: Array<{ id: string; title: string; url: string; date?: string | null }>; cost?: number } = {}) {
  return {
    model: 'perplexity/sonar',
    output: [
      ...(extra.results ? [{ results: extra.results, type: 'search_results' }] : []),
      { content: [{ text, type: 'output_text' }], type: 'message' },
    ],
    status: 'completed',
    usage: { cost: { currency: 'USD', total_cost: extra.cost ?? 0.0123 }, input_tokens: 800, output_tokens: 200, total_tokens: 1000 },
  };
}

function mockFetch(responder: (body: Record<string, unknown>, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<Record<string, unknown>> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(AGENT_API_URL);
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return responder(body, init ?? {});
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

function post(path: string, body: unknown): Request {
  return new Request(`${BASE}/${path}`, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, method: 'POST' });
}

describe('parseAgentResponse', () => {
  it('reads text, search results and cost from the Agent API shape', () => {
    const parsed = parseAgentResponse(agentReply('Hello [1]', { cost: 0.5, results: [{ date: '2026-01-02', id: '1', title: 'T', url: 'https://wavu.wiki/x' }] }));
    expect(parsed).toEqual({
      model: 'perplexity/sonar',
      results: [{ date: '2026-01-02', id: '1', last_updated: null, snippet: undefined, title: 'T', url: 'https://wavu.wiki/x' }],
      text: 'Hello [1]',
      usage: { costUsd: 0.5, inputTokens: 800, outputTokens: 200, totalTokens: 1000 },
    });
  });

  it('tolerates missing pieces', () => {
    expect(parseAgentResponse({ output_text: 'plain' }).text).toBe('plain');
    expect(parseAgentResponse(null).usage.costUsd).toBe(0);
  });
});

describe('transcript', () => {
  it('passes one message through and flattens a conversation', () => {
    expect(transcript([{ content: 'Q', role: 'user' }])).toBe('Q');
    expect(transcript([{ content: 'Q1', role: 'user' }, { content: 'A1', role: 'assistant' }, { content: 'Q2', role: 'user' }]))
      .toBe('Sagar: Q1\n\nCoach: A1\n\nSagar: Q2\n\nCoach:');
  });
});

describe('intel handler', () => {
  it('health and usage work without a key and say the key is missing', async () => {
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: undefined, capUsd: 3, nowIso: () => NOW, store });
    const health = await (await handler(new Request(`${BASE}/health`))).json() as { ok: boolean; keyConfigured: boolean; capUsd: number };
    expect(health).toMatchObject({ capUsd: 3, keyConfigured: false, ok: true });
    const usage = await (await handler(new Request(`${BASE}/usage`))).json() as { days: unknown[] };
    expect(usage.days).toHaveLength(7);
    const coach = await handler(post('coach', { messages: [{ content: 'hi', role: 'user' }], system: 'sys' }));
    expect(coach.status).toBe(503);
    expect(((await coach.json()) as { error: string }).error).toMatch(/PERPLEXITY_API_KEY/);
  });

  it('coach: sends instructions + transcript, returns text and records the spend', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('Do the drill.\n\nNext action: Lab.', { cost: 0.02 })));
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    const response = await handler(post('coach', {
      messages: [{ content: 'What next?', role: 'user' }],
      model: 'anthropic/claude-sonnet-5-5',
      system: 'You are the coach.',
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { text: string; model: string; usage: { costUsd: number; todayUsd: number; capUsd: number } };
    expect(body.text).toBe('Do the drill.\n\nNext action: Lab.');
    expect(body.model).toBe('anthropic/claude-sonnet-5-5');
    expect(body.usage).toMatchObject({ capUsd: 3, costUsd: 0.02, todayUsd: 0.02 });
    expect(calls[0]).toMatchObject({ input: 'What next?', instructions: 'You are the coach.', max_output_tokens: 600, model: 'anthropic/claude-sonnet-5-5' });
    expect(calls[0]).not.toHaveProperty('tools');
    const days = await recentUsage(store, NOW, 1);
    expect(days[0]).toMatchObject({ costUsd: 0.02, inputTokens: 800, outputTokens: 200, requests: 1 });
  });

  it('refuses unknown models and bad bodies before spending anything', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('x')));
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store: memoryStore() });
    expect((await handler(post('coach', { messages: [{ content: 'hi', role: 'user' }], model: 'openai/gpt-99', system: 'sys' }))).status).toBe(400);
    expect((await handler(post('coach', { messages: [], system: 'sys' }))).status).toBe(400);
    expect((await handler(new Request(`${BASE}/coach`, { body: '{nope', method: 'POST' }))).status).toBe(400);
    expect((await handler(new Request(`${BASE}/nothing`))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('stops at the daily cap and keeps answering health', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('x', { cost: 2 })));
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    expect((await handler(post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }))).status).toBe(200);
    expect((await handler(post('coach', { messages: [{ content: 'b', role: 'user' }], system: 's' }))).status).toBe(200);
    const third = await handler(post('coach', { messages: [{ content: 'c', role: 'user' }], system: 's' }));
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ capUsd: 3, todayUsd: 4 });
    expect(calls).toHaveLength(2);
    const health = await (await handler(new Request(`${BASE}/health`))).json() as { today: { costUsd: number } };
    expect(health.today.costUsd).toBe(4);
  });

  it('research: searches trusted sites only and returns citations', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('Duck the second hit [1].', {
      results: [{ date: '2026-09-01', id: '1', title: 'Yoshimitsu guide', url: 'https://wavu.wiki/t/Yoshimitsu' }],
    })));
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store: memoryStore() });
    const response = await handler(post('research', { context: 'Record vs Jin: 2-8.', question: 'How do I deal with Jin f,f+2?', recency: 'year' }));
    expect(response.status).toBe(200);
    const body = await response.json() as { text: string; citations: Array<{ id: string; url: string }>; model: string };
    expect(body.text).toBe('Duck the second hit [1].');
    expect(body.citations).toEqual([{ date: '2026-09-01', id: '1', title: 'Yoshimitsu guide', url: 'https://wavu.wiki/t/Yoshimitsu' }]);
    expect(body.model).toBe('perplexity/sonar');
    const sent = calls[0] as { tools: Array<{ type: string; search_type: string; filters: { search_domain_filter: string[]; search_recency_filter: string } }>; input: string };
    expect(sent.tools[0]).toMatchObject({ search_type: 'fast', type: 'web_search' });
    expect(sent.tools[0]?.filters.search_domain_filter).toContain('wavu.wiki');
    expect(sent.tools[0]?.filters.search_recency_filter).toBe('year');
    expect(sent.input).toContain('Record vs Jin');
  });

  it('primer: generated once, cached for 30 days, refreshable, stale copy kept on failure', async () => {
    let fail = false;
    const { calls, fetchFn } = mockFetch(() => (fail ? okJson({ error: { message: 'down' } }, 503) : okJson(agentReply('**Their plan**\n- Pressure [1]', {
      results: [{ id: '1', title: 'Kazuya', url: 'https://tekkendocs.com/t8/kazuya' }],
    }))));
    const store = memoryStore();
    let now = NOW;
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => now, store });
    const first = await (await handler(new Request(`${BASE}/primer/Kazuya`))).json() as { cached: boolean; character: string; generatedAt: string; citations: unknown[] };
    expect(first).toMatchObject({ cached: false, character: 'Kazuya', generatedAt: NOW });
    expect(first.citations).toHaveLength(1);
    const second = await (await handler(new Request(`${BASE}/primer/kazuya`))).json() as { cached: boolean };
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
    now = new Date(Date.parse(NOW) + PRIMER_TTL_MS + 1000).toISOString();
    fail = true;
    const stale = await handler(new Request(`${BASE}/primer/Kazuya`));
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({ cached: true, stale: true });
    fail = false;
    const refreshed = await (await handler(new Request(`${BASE}/primer/Kazuya?refresh=1`))).json() as { cached: boolean; generatedAt: string };
    expect(refreshed.cached).toBe(false);
    expect(refreshed.generatedAt).toBe(now);
    expect((await handler(new Request(`${BASE}/primer/%3Cscript%3E`))).status).toBe(400);
  });

  it('patch brief: lists the changes for the model and caches by revision', async () => {
    const { calls, fetchFn } = mockFetch(() => okJson(agentReply('- 1+4: reported +2 more recovery [1]\nRe-verify 1+4.', {
      results: [{ id: '1', title: 'Patch notes', url: 'https://tekken.com/news/patch' }],
    })));
    const store = memoryStore();
    const handler = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn, nowIso: () => NOW, store });
    const body = { changes: [{ after: '-21', before: '-20', field: 'block', input: '1+4', moveId: 'Yoshimitsu-1+4', name: 'Soul Stealer' }], patch: '3.03', revision: '99999' };
    const first = await (await handler(post('patch-brief', body))).json() as { cached: boolean; revision: string; text: string };
    expect(first).toMatchObject({ cached: false, revision: '99999' });
    expect((calls[0] as { input: string }).input).toContain('1+4 (Soul Stealer): block -20 → -21');
    const again = await (await handler(post('patch-brief', body))).json() as { cached: boolean };
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('reports a rejected key and a timeout in plain words', async () => {
    const bad = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn: mockFetch(() => okJson({ error: 'unauthorized' }, 401)).fetchFn, nowIso: () => NOW, store: memoryStore() });
    const rejected = await bad.call(null, post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }));
    expect(rejected.status).toBe(502);
    expect(((await rejected.json()) as { error: string }).error).toMatch(/rejected the server key/);

    const slow = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const timing = createIntelHandler({ apiKey: 'test-key', capUsd: 3, fetchFn: slow, nowIso: () => NOW, store: memoryStore(), timeoutMs: 20 });
    const late = await timing(post('coach', { messages: [{ content: 'a', role: 'user' }], system: 's' }));
    expect(late.status).toBe(504);
    expect(((await late.json()) as { error: string }).error).toMatch(/too long/);
  });
});
