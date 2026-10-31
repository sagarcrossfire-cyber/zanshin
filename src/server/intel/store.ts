// Release 1.3.0 — the intel function's small persistent store (Netlify Blobs
// in production, a Map in tests): cached primers and patch briefs, and the
// day's spend so a runaway client cannot empty the prepaid balance.

export interface IntelStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
}

export function memoryStore(initial: Record<string, unknown> = {}): IntelStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.has(key) ? (data.get(key) as unknown) : null;
    },
    async set(key, value) {
      data.set(key, value);
    },
  };
}

export interface DailyUsage {
  day: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function dayKey(nowIso: string): string {
  return nowIso.slice(0, 10);
}

function usageKey(day: string): string {
  return `usage/${day}`;
}

export async function readUsage(store: IntelStore, day: string): Promise<DailyUsage> {
  const raw = (await store.get(usageKey(day))) as Partial<DailyUsage> | null;
  return {
    costUsd: typeof raw?.costUsd === 'number' ? raw.costUsd : 0,
    day,
    inputTokens: typeof raw?.inputTokens === 'number' ? raw.inputTokens : 0,
    outputTokens: typeof raw?.outputTokens === 'number' ? raw.outputTokens : 0,
    requests: typeof raw?.requests === 'number' ? raw.requests : 0,
  };
}

export async function addUsage(
  store: IntelStore,
  day: string,
  delta: { inputTokens: number; outputTokens: number; costUsd: number },
): Promise<DailyUsage> {
  const current = await readUsage(store, day);
  const next: DailyUsage = {
    costUsd: Math.round((current.costUsd + delta.costUsd) * 1e6) / 1e6,
    day,
    inputTokens: current.inputTokens + delta.inputTokens,
    outputTokens: current.outputTokens + delta.outputTokens,
    requests: current.requests + 1,
  };
  await store.set(usageKey(day), next);
  return next;
}

/** The last `days` days of usage, newest first (days with no spend included). */
export async function recentUsage(store: IntelStore, nowIso: string, days: number): Promise<DailyUsage[]> {
  const out: DailyUsage[] = [];
  const start = Date.parse(`${dayKey(nowIso)}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start - i * 86_400_000).toISOString().slice(0, 10);
    out.push(await readUsage(store, day));
  }
  return out;
}
