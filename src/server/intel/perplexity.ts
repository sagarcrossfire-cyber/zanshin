// Release 1.3.0 — the Perplexity Agent API, as the intel function uses it.
// Runs on the server only (netlify/functions/intel.mts); the browser never
// sees the key. One request type: instructions + input, optional web search
// tool, parsed into text, search results and the cost Perplexity reports.
//
// Docs: https://docs.perplexity.ai/docs/agent-api/quickstart and
// https://docs.perplexity.ai/docs/agent-api/tools (shapes as of Oct 2026).

export const AGENT_API_URL = 'https://api.perplexity.ai/v1/agent';

export {
  DEFAULT_COACH_MODEL, DEFAULT_RESEARCH_MODEL, INTEL_MODELS, isIntelModel, type IntelModel,
} from '../../domain/intel/models';
import type { IntelModel } from '../../domain/intel/models';

export interface WebSearchTool {
  type: 'web_search';
  search_type?: 'fast' | 'web';
  max_results?: number;
  max_tokens?: number;
  max_tokens_per_page?: number;
  filters?: {
    search_domain_filter?: string[];
    search_recency_filter?: 'hour' | 'day' | 'week' | 'month' | 'year';
  };
}

export interface AgentRequestBody {
  model: IntelModel;
  instructions: string;
  input: string;
  max_output_tokens: number;
  tools?: WebSearchTool[];
  max_steps?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  date?: string | null;
  last_updated?: string | null;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** USD, as reported by Perplexity (0 when the response carried no cost). */
  costUsd: number;
}

export interface AgentResult {
  text: string;
  results: SearchResult[];
  usage: AgentUsage;
  model: string;
}

export class PerplexityError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PerplexityError';
    this.status = status;
  }
}

interface RawOutputItem {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
  results?: Array<Partial<SearchResult> & { id?: string | number }>;
}

interface RawAgentResponse {
  model?: string;
  output?: RawOutputItem[];
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost?: { total_cost?: number };
  };
  error?: { message?: string } | string | null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Turns a raw Agent API response into text, results and usage. */
export function parseAgentResponse(raw: unknown): AgentResult {
  const body = (raw ?? {}) as RawAgentResponse;
  const texts: string[] = [];
  const results: SearchResult[] = [];
  for (const item of body.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
      }
    } else if (item.type === 'search_results') {
      for (const result of item.results ?? []) {
        if (typeof result.url !== 'string') continue;
        results.push({
          date: result.date ?? null,
          id: String(result.id ?? results.length + 1),
          last_updated: result.last_updated ?? null,
          snippet: typeof result.snippet === 'string' ? result.snippet : undefined,
          title: typeof result.title === 'string' ? result.title : result.url,
          url: result.url,
        });
      }
    }
  }
  const text = texts.length > 0 ? texts.join('\n') : typeof body.output_text === 'string' ? body.output_text : '';
  const usage = body.usage ?? {};
  return {
    model: typeof body.model === 'string' ? body.model : '',
    results,
    text,
    usage: {
      costUsd: numberOr(usage.cost?.total_cost, 0),
      inputTokens: numberOr(usage.input_tokens, 0),
      outputTokens: numberOr(usage.output_tokens, 0),
      totalTokens: numberOr(usage.total_tokens, 0),
    },
  };
}

export interface AgentCallOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** One Agent API call. Throws PerplexityError on any non-2xx or timeout. */
export async function callAgent(apiKey: string, body: AgentRequestBody, options: AgentCallOptions = {}): Promise<AgentResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 9000);
  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    let response: Response;
    try {
      response = await fetchFn(AGENT_API_URL, {
        body: JSON.stringify(body),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new PerplexityError(504, 'Perplexity took too long to answer.');
      throw new PerplexityError(502, `Could not reach Perplexity: ${error instanceof Error ? error.message : 'network error'}`);
    }
    if (!response.ok) {
      let detail = '';
      try {
        const errBody = (await response.json()) as { error?: { message?: string } | string };
        detail = typeof errBody.error === 'string' ? errBody.error : errBody.error?.message ?? '';
      } catch {
        // No JSON body.
      }
      throw new PerplexityError(response.status, `Perplexity answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new PerplexityError(502, 'Perplexity sent an unreadable response.');
    }
    const parsed = parseAgentResponse(json);
    if (parsed.text.trim() === '') throw new PerplexityError(502, 'Perplexity sent an empty answer.');
    return parsed;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
