// Release 1.3.0 — client for the site's intel function
// (netlify/functions/intel.mts). The function holds the Perplexity key and
// a daily spend cap; this module only ever talks to the app's own origin.
// Everything that comes back is prose with citations: it is shown with the
// 'web' badge and saved as research notes, never written into frame data.
import type { IntelModel } from '../domain/intel/models';
import type { ResearchCitation } from '../data/schemas';

export {
  DEFAULT_COACH_MODEL, DEFAULT_RESEARCH_MODEL, INTEL_MODELS, intelModelOptions, isIntelModel, type IntelModel,
} from '../domain/intel/models';

export const INTEL_BASE_URL = '/.netlify/functions/intel';
/** Netlify's synchronous function limit is ~10 s; the server aborts at 9 s. */
export const INTEL_TIMEOUT_MS = 20_000;

export interface IntelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  todayUsd: number;
  capUsd: number;
}

export interface IntelHealth {
  ok: boolean;
  keyConfigured: boolean;
  /** False when the site is running without Netlify Blobs (caches and cap per instance only). */
  durableStore?: boolean;
  capUsd: number;
  today: { day: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number };
  defaultModels: { coach: IntelModel; research: IntelModel };
  models: Array<{ id: IntelModel; label: string; note: string }>;
}

export interface IntelUsageReport {
  capUsd: number;
  days: Array<{ day: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
}

export interface ResearchAnswer {
  text: string;
  citations: ResearchCitation[];
  model: string;
  usage: IntelUsage;
}

export interface PrimerResult extends ResearchAnswer {
  character: string;
  generatedAt: string;
  cached: boolean;
  stale: boolean;
}

export interface PatchBriefResult extends ResearchAnswer {
  revision: string;
  generatedAt: string;
  cached: boolean;
}

export interface PatchBriefChange {
  moveId: string;
  input: string;
  name?: string;
  field: string;
  before: string;
  after: string;
}

/** A failure the intel function reported, in words the screen can show. */
export class IntelError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'IntelError';
    this.status = status;
  }
  /** True when the daily cap stopped the call (HTTP 429). */
  get capReached(): boolean {
    return this.status === 429;
  }
  /** True when the site has no Perplexity key (HTTP 503). */
  get notConfigured(): boolean {
    return this.status === 503;
  }
}

export interface IntelClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

function toCitations(raw: unknown): ResearchCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchCitation[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (typeof item?.url !== 'string' || item.url === '') continue;
    out.push({
      date: typeof item.date === 'string' ? item.date : null,
      id: String(item.id ?? out.length + 1),
      title: typeof item.title === 'string' && item.title !== '' ? item.title : item.url,
      url: item.url,
    });
  }
  return out;
}

function toUsage(raw: unknown): IntelUsage {
  const usage = (raw ?? {}) as Partial<IntelUsage>;
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    capUsd: num(usage.capUsd),
    costUsd: num(usage.costUsd),
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    todayUsd: num(usage.todayUsd),
  };
}

/** Request to the intel function; throws IntelError with the server's words. */
export async function intelRequest<T>(route: string, init: RequestInit & { options?: IntelClientOptions } = {}): Promise<T> {
  const { options, ...requestInit } = init;
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? INTEL_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchFn(`${options?.baseUrl ?? INTEL_BASE_URL}/${route}`, {
      ...requestInit,
      headers: { Accept: 'application/json', ...(requestInit.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(requestInit.headers ?? {}) },
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new IntelError(controller.signal.aborted ? 504 : 0, controller.signal.aborted
      ? 'The site took too long to answer. Try again, or pick a faster model in Settings.'
      : 'Could not reach the site. Research needs a connection.');
  }
  clearTimeout(timer);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = typeof (body as { error?: unknown })?.error === 'string'
      ? (body as { error: string }).error
      : `The site answered HTTP ${response.status}.`;
    throw new IntelError(response.status, message);
  }
  return body as T;
}

export async function intelHealth(options?: IntelClientOptions): Promise<IntelHealth> {
  return intelRequest<IntelHealth>('health', { options });
}

export async function intelUsage(options?: IntelClientOptions): Promise<IntelUsageReport> {
  return intelRequest<IntelUsageReport>('usage', { options });
}

export interface ResearchInput {
  question: string;
  /** Short app context (record vs the character, problem moves) the model may use. */
  context?: string;
  model?: IntelModel;
  recency?: 'day' | 'week' | 'month' | 'year';
}

export async function research(input: ResearchInput, options?: IntelClientOptions): Promise<ResearchAnswer> {
  const raw = await intelRequest<Record<string, unknown>>('research', { body: JSON.stringify(input), method: 'POST', options });
  return {
    citations: toCitations(raw.citations),
    model: typeof raw.model === 'string' ? raw.model : 'unknown',
    text: typeof raw.text === 'string' ? raw.text : '',
    usage: toUsage(raw.usage),
  };
}

export async function matchupPrimer(character: string, refresh = false, options?: IntelClientOptions): Promise<PrimerResult> {
  const raw = await intelRequest<Record<string, unknown>>(`primer/${encodeURIComponent(character)}${refresh ? '?refresh=1' : ''}`, { options });
  return {
    cached: raw.cached === true,
    character: typeof raw.character === 'string' ? raw.character : character,
    citations: toCitations(raw.citations),
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    model: typeof raw.model === 'string' ? raw.model : 'unknown',
    stale: raw.stale === true,
    text: typeof raw.text === 'string' ? raw.text : '',
    usage: toUsage(raw.usage),
  };
}

export async function patchBrief(
  input: { revision: string; patch?: string; changes: PatchBriefChange[]; refresh?: boolean },
  options?: IntelClientOptions,
): Promise<PatchBriefResult> {
  const raw = await intelRequest<Record<string, unknown>>('patch-brief', { body: JSON.stringify(input), method: 'POST', options });
  return {
    cached: raw.cached === true,
    citations: toCitations(raw.citations),
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : new Date().toISOString(),
    model: typeof raw.model === 'string' ? raw.model : 'unknown',
    revision: typeof raw.revision === 'string' ? raw.revision : input.revision,
    text: typeof raw.text === 'string' ? raw.text : '',
    usage: toUsage(raw.usage),
  };
}

/** "$0.12 of $3.00 today" for the cost meter. */
export function formatSpend(todayUsd: number, capUsd: number): string {
  return `$${todayUsd.toFixed(2)} of $${capUsd.toFixed(2)} today`;
}
