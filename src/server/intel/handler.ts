// Release 1.3.0 — the intel function's request handler, as a pure function
// of its dependencies so tests can drive it with Request objects and a
// memory store. Routes (all under /.netlify/functions/intel/):
//
//   GET  health         key present? cap, today's spend, models
//   GET  usage          today plus the last seven days
//   POST coach          { system, messages, model?, maxTokens? } → { text, usage }
//   POST research       { question, context? } → { text, citations, usage }
//   GET  primer/:name   cached matchup primer (?refresh=1 regenerates)
//   POST patch-brief    { revision, patch?, changes[] } → cached brief
//
// Every paid call checks the daily cap first and records what it cost after.
// The key is read from the environment by the caller and never logged.
import { z } from 'zod';
import {
  DEFAULT_COACH_MODEL,
  DEFAULT_RESEARCH_MODEL,
  INTEL_MODELS,
  PerplexityError,
  callAgent,
  isIntelModel,
  type AgentCallOptions,
  type AgentRequestBody,
  type AgentResult,
  type IntelModel,
  type SearchResult,
} from './perplexity';
import {
  COACH_MAX_OUTPUT_TOKENS,
  PATCH_INSTRUCTIONS,
  PATCH_MAX_OUTPUT_TOKENS,
  PRIMER_MAX_OUTPUT_TOKENS,
  RESEARCH_INSTRUCTIONS,
  RESEARCH_MAX_OUTPUT_TOKENS,
  patchInput,
  primerInput,
  primerInstructions,
  webSearchTool,
} from './prompts';
import { addUsage, dayKey, readUsage, recentUsage, type DailyUsage, type IntelStore } from './store';

export const PRIMER_TTL_MS = 30 * 86_400_000;

export interface IntelDeps {
  apiKey: string | undefined;
  /** Daily spend cap in USD; paid calls stop once today's spend reaches it. */
  capUsd: number;
  store: IntelStore;
  /** False when the store is a per-instance fallback (Blobs unavailable):
   * caches and the cap then do not survive a cold start. Reported by /health. */
  durableStore?: boolean;
  fetchFn?: typeof fetch;
  nowIso?: () => string;
  /** Per-call timeout; Netlify's own limit is 10 s. */
  timeoutMs?: number;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  date: string | null;
}

export interface IntelUsageOut {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  todayUsd: number;
  capUsd: number;
}

const messageSchema = z.object({ content: z.string().min(1).max(20_000), role: z.enum(['user', 'assistant']) });

const coachBody = z.object({
  maxTokens: z.number().int().min(50).max(1200).optional(),
  messages: z.array(messageSchema).min(1).max(20),
  model: z.string().optional(),
  system: z.string().min(1).max(60_000),
});

const researchBody = z.object({
  context: z.string().max(4000).optional(),
  model: z.string().optional(),
  question: z.string().min(3).max(1000),
  recency: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
});

const patchBody = z.object({
  changes: z.array(z.object({
    after: z.string().max(80),
    before: z.string().max(80),
    field: z.string().min(1).max(40),
    input: z.string().min(1).max(60),
    moveId: z.string().min(1).max(120),
    name: z.string().max(80).optional(),
  })).min(1).max(60),
  patch: z.string().max(40).optional(),
  refresh: z.boolean().optional(),
  revision: z.string().min(1).max(40),
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    status,
  });
}

function problem(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status);
}

function toCitations(results: SearchResult[]): Citation[] {
  return results.map((r) => ({ date: r.date ?? null, id: r.id, title: r.title, url: r.url }));
}

/** Messages flattened into one transcript: the Agent API takes a single input string. */
export function transcript(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (messages.length === 1 && messages[0]) return messages[0].content;
  return messages.map((m) => `${m.role === 'user' ? 'Sagar' : 'Coach'}: ${m.content}`).join('\n\n') + '\n\nCoach:';
}

export function createIntelHandler(deps: IntelDeps): (request: Request) => Promise<Response> {
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const callOptions: AgentCallOptions = { fetchFn: deps.fetchFn, timeoutMs: deps.timeoutMs ?? 9000 };

  const guard = async (): Promise<Response | DailyUsage> => {
    if (!deps.apiKey) return problem(503, 'The Perplexity key is not configured on the server (PERPLEXITY_API_KEY).');
    const today = await readUsage(deps.store, dayKey(nowIso()));
    if (deps.capUsd > 0 && today.costUsd >= deps.capUsd) {
      return problem(429, `Today's spending cap of $${deps.capUsd.toFixed(2)} is reached ($${today.costUsd.toFixed(2)} spent). Raise INTEL_DAILY_CAP_USD or try tomorrow.`, {
        capUsd: deps.capUsd,
        todayUsd: today.costUsd,
      });
    }
    return today;
  };

  const paidCall = async (body: AgentRequestBody): Promise<{ result: AgentResult; usage: IntelUsageOut } | Response> => {
    const guarded = await guard();
    if (guarded instanceof Response) return guarded;
    let result: AgentResult;
    try {
      result = await callAgent(deps.apiKey as string, body, callOptions);
    } catch (error) {
      if (error instanceof PerplexityError) {
        const status = error.status === 504 ? 504 : error.status === 401 || error.status === 403 ? 502 : error.status >= 500 ? 502 : 502;
        const message = error.status === 401 || error.status === 403
          ? 'Perplexity rejected the server key; check PERPLEXITY_API_KEY in Netlify.'
          : error.message;
        return problem(status, message);
      }
      return problem(502, error instanceof Error ? error.message : 'Unknown error talking to Perplexity.');
    }
    const today = await addUsage(deps.store, dayKey(nowIso()), {
      costUsd: result.usage.costUsd,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return {
      result,
      usage: {
        capUsd: deps.capUsd,
        costUsd: result.usage.costUsd,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        todayUsd: today.costUsd,
      },
    };
  };

  const modelOr = (requested: unknown, fallback: IntelModel): IntelModel | Response => {
    if (requested === undefined || requested === '') return fallback;
    if (isIntelModel(requested)) return requested;
    return problem(400, `Unknown model. Choose one of: ${Object.keys(INTEL_MODELS).join(', ')}.`);
  };

  const readJson = async (request: Request): Promise<unknown | Response> => {
    try {
      return await request.json();
    } catch {
      return problem(400, 'The request body is not valid JSON.');
    }
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/intel\/?(.*)$/);
    const route = (match?.[1] ?? '').replace(/\/+$/, '');
    const [head, ...rest] = route.split('/');

    if (request.method === 'GET' && head === 'health') {
      const today = await readUsage(deps.store, dayKey(nowIso()));
      return json({
        capUsd: deps.capUsd,
        defaultModels: { coach: DEFAULT_COACH_MODEL, research: DEFAULT_RESEARCH_MODEL },
        durableStore: deps.durableStore ?? true,
        keyConfigured: Boolean(deps.apiKey),
        models: INTEL_MODELS,
        ok: true,
        today,
      });
    }

    if (request.method === 'GET' && head === 'usage') {
      return json({ capUsd: deps.capUsd, days: await recentUsage(deps.store, nowIso(), 7) });
    }

    if (request.method === 'POST' && head === 'coach') {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const parsed = coachBody.safeParse(body);
      if (!parsed.success) return problem(400, `Invalid coach request: ${parsed.error.issues[0]?.message ?? 'bad body'}.`);
      const model = modelOr(parsed.data.model, DEFAULT_COACH_MODEL);
      if (model instanceof Response) return model;
      const outcome = await paidCall({
        input: transcript(parsed.data.messages),
        instructions: parsed.data.system,
        max_output_tokens: parsed.data.maxTokens ?? COACH_MAX_OUTPUT_TOKENS,
        model,
      });
      if (outcome instanceof Response) return outcome;
      return json({ model, text: outcome.result.text, usage: outcome.usage });
    }

    if (request.method === 'POST' && head === 'research') {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const parsed = researchBody.safeParse(body);
      if (!parsed.success) return problem(400, `Invalid research request: ${parsed.error.issues[0]?.message ?? 'bad body'}.`);
      const model = modelOr(parsed.data.model, DEFAULT_RESEARCH_MODEL);
      if (model instanceof Response) return model;
      const input = parsed.data.context
        ? `${parsed.data.question}\n\nWhat the app knows (for your reference, do not repeat it back):\n${parsed.data.context}`
        : parsed.data.question;
      const outcome = await paidCall({
        input,
        instructions: RESEARCH_INSTRUCTIONS,
        max_output_tokens: RESEARCH_MAX_OUTPUT_TOKENS,
        max_steps: 3,
        model,
        tools: [webSearchTool(parsed.data.recency)],
      });
      if (outcome instanceof Response) return outcome;
      return json({ citations: toCitations(outcome.result.results), model, text: outcome.result.text, usage: outcome.usage });
    }

    if (request.method === 'GET' && head === 'primer') {
      const character = decodeURIComponent(rest.join('/')).trim();
      if (!/^[A-Za-z][A-Za-z .'-]{1,30}$/.test(character)) return problem(400, 'Give a character name, such as primer/Kazuya.');
      const key = `primer/${character.toLowerCase()}`;
      const refresh = url.searchParams.get('refresh') === '1';
      const cached = (await deps.store.get(key)) as { generatedAt?: string } | null;
      if (!refresh && cached && typeof cached.generatedAt === 'string' && Date.parse(nowIso()) - Date.parse(cached.generatedAt) < PRIMER_TTL_MS) {
        return json({ ...cached, cached: true });
      }
      const outcome = await paidCall({
        input: primerInput(character),
        instructions: primerInstructions(),
        max_output_tokens: PRIMER_MAX_OUTPUT_TOKENS,
        max_steps: 3,
        model: DEFAULT_RESEARCH_MODEL,
        tools: [webSearchTool()],
      });
      if (outcome instanceof Response) {
        // A stale primer beats no primer when the refresh failed.
        if (cached && typeof cached.generatedAt === 'string') return json({ ...cached, cached: true, stale: true });
        return outcome;
      }
      const primer = {
        character,
        citations: toCitations(outcome.result.results),
        generatedAt: nowIso(),
        model: DEFAULT_RESEARCH_MODEL,
        text: outcome.result.text,
        usage: outcome.usage,
      };
      await deps.store.set(key, primer);
      return json({ ...primer, cached: false });
    }

    if (request.method === 'POST' && head === 'patch-brief') {
      const body = await readJson(request);
      if (body instanceof Response) return body;
      const parsed = patchBody.safeParse(body);
      if (!parsed.success) return problem(400, `Invalid patch request: ${parsed.error.issues[0]?.message ?? 'bad body'}.`);
      const key = `patch/${parsed.data.revision}`;
      const cached = (await deps.store.get(key)) as { generatedAt?: string } | null;
      if (!parsed.data.refresh && cached) return json({ ...cached, cached: true });
      const outcome = await paidCall({
        input: patchInput(parsed.data.revision, parsed.data.patch, parsed.data.changes),
        instructions: PATCH_INSTRUCTIONS,
        max_output_tokens: PATCH_MAX_OUTPUT_TOKENS,
        max_steps: 3,
        model: DEFAULT_RESEARCH_MODEL,
        tools: [webSearchTool('year')],
      });
      if (outcome instanceof Response) return outcome;
      const brief = {
        citations: toCitations(outcome.result.results),
        generatedAt: nowIso(),
        model: DEFAULT_RESEARCH_MODEL,
        revision: parsed.data.revision,
        text: outcome.result.text,
        usage: outcome.usage,
      };
      await deps.store.set(key, brief);
      return json({ ...brief, cached: false });
    }

    return problem(404, `No such intel route: ${request.method} ${route || '/'}.`);
  };
}
