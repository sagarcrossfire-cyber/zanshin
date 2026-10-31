// Spec §8.7 — coach provider types and shared request machinery.
// No API keys live in this code: keys arrive through provider config only.

/** 'zanshin' (1.3.0): the site's own intel function; the key stays on the server. */
export type CoachProviderId = 'none' | 'openai-compatible' | 'anthropic' | 'mock' | 'zanshin';

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoachRequest {
  system: string;
  messages: CoachMessage[];
  /** Default 600. */
  maxTokens: number;
  signal: AbortSignal;
}

export interface CoachResponse {
  text: string;
}

export interface CoachProvider {
  id: CoachProviderId;
  send(input: CoachRequest): Promise<CoachResponse>;
}

/** Thrown after the retry budget is spent, or for non-retryable failures. Never carries a key. */
export class CoachUnavailable extends Error {
  constructor(reason: string) {
    super(`AI coach unavailable: ${reason}`);
    this.name = 'CoachUnavailable';
  }
}

export const PROVIDER_TIMEOUT_MS = 30000;
export const PROVIDER_RETRY_DELAY_MS = 2000;

export interface ProviderFetchOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * POST with a 30-second timeout, retried once after 2 seconds on a network
 * error, HTTP 429 or a 5xx. After that, throws CoachUnavailable. The caller's
 * AbortSignal aborts immediately without a retry.
 */
export async function fetchWithRetry(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? PROVIDER_RETRY_DELAY_MS;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetchFn(url, { ...init, signal: controller.signal });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 0) {
          await delay(retryDelayMs);
          continue;
        }
        throw new CoachUnavailable(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new CoachUnavailable(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      if (error instanceof CoachUnavailable) throw error;
      if (options.signal?.aborted === true) throw new CoachUnavailable('request aborted');
      if (attempt === 0) {
        await delay(retryDelayMs);
        continue;
      }
      throw new CoachUnavailable('network error');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }
  throw new CoachUnavailable('network error');
}

export async function parseJsonBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new CoachUnavailable('invalid response');
  }
}
