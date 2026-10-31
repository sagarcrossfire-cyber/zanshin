// Release 1.3.0 — the ZANSHIN provider: the coach's own site answers through
// its intel function (netlify/functions/intel.mts), which holds the
// Perplexity key and routes to a frontier model. The browser sends the same
// system prompt and messages it would send any provider, to its own origin,
// and never sees a key. Server errors come back in plain words (daily cap
// reached, key missing, model too slow) so the Coach screen can show them.
import { DEFAULT_COACH_MODEL, isIntelModel, type IntelModel } from '../../intel/models';
import { CoachUnavailable, type CoachProvider, type CoachRequest, type CoachResponse } from './index';

export const ZANSHIN_COACH_URL = '/.netlify/functions/intel/coach';
/** The function itself gives up at 9 s; this only covers a dead connection. */
export const ZANSHIN_TIMEOUT_MS = 20_000;

export interface ZanshinConfig {
  model?: string;
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ZanshinResponse {
  text?: unknown;
  usage?: { costUsd?: number; todayUsd?: number; capUsd?: number };
  error?: unknown;
}

export class ZanshinProvider implements CoachProvider {
  readonly id = 'zanshin' as const;
  readonly model: IntelModel;
  private readonly config: ZanshinConfig;
  /** Spend reported by the last successful answer, for the Settings meter. */
  lastUsage: { costUsd: number; todayUsd: number; capUsd: number } | null = null;

  constructor(config: ZanshinConfig = {}) {
    this.config = config;
    const requested = config.model?.trim();
    this.model = isIntelModel(requested) ? requested : DEFAULT_COACH_MODEL;
  }

  async send(input: CoachRequest): Promise<CoachResponse> {
    const fetchFn = this.config.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? ZANSHIN_TIMEOUT_MS);
    const onAbort = (): void => controller.abort();
    input.signal.addEventListener('abort', onAbort, { once: true });
    let response: Response;
    try {
      response = await fetchFn(this.config.url ?? ZANSHIN_COACH_URL, {
        body: JSON.stringify({ maxTokens: input.maxTokens, messages: input.messages, model: this.model, system: input.system }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      });
    } catch {
      if (input.signal.aborted) throw new CoachUnavailable('request aborted');
      throw new CoachUnavailable(controller.signal.aborted ? 'the site took too long to answer' : 'network error');
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onAbort);
    }
    let body: ZanshinResponse | null = null;
    try {
      body = (await response.json()) as ZanshinResponse;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const detail = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new CoachUnavailable(detail);
    }
    if (typeof body?.text !== 'string' || body.text.trim() === '') throw new CoachUnavailable('invalid response');
    const usage = body.usage;
    if (usage && typeof usage.costUsd === 'number' && typeof usage.todayUsd === 'number' && typeof usage.capUsd === 'number') {
      this.lastUsage = { capUsd: usage.capUsd, costUsd: usage.costUsd, todayUsd: usage.todayUsd };
    }
    return { text: body.text };
  }
}
