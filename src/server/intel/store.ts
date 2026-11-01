// Release 1.3.0 — the intel function's small persistent store (Netlify Blobs
// in production, a Map in tests): cached primers and patch briefs, and the
// day's spend so a runaway client cannot empty the prepaid balance.
//
// 2.0 M1 — the spend ledger is one key per paid call,
// `usage/<day>/<requestId>~c<micro-USD>~i<input>~o<output>`, written with
// onlyIfNew and summed with list({prefix}). Blobs is last-write-wins, so the
// 1.3 read-modify-write of a single `usage/<day>` key lost increments when
// calls ran in parallel (docs/ops/RCA_LOG.md, 2026-11-01). The numbers sit in
// the key so one list call totals the day without reading every entry; the
// entry's value repeats them for anyone browsing the store. The old single
// key is still read and added, so the cap stays right on the day of rollout.

export interface IntelStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Writes `key` only if it does not exist yet; false when it already did. */
  setIfNew(key: string, value: unknown): Promise<boolean>;
  /** Every key that starts with `prefix`. */
  list(prefix: string): Promise<string[]>;
}

export function memoryStore(initial: Record<string, unknown> = {}): IntelStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.has(key) ? (data.get(key) as unknown) : null;
    },
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    async set(key, value) {
      data.set(key, value);
    },
    async setIfNew(key, value) {
      if (data.has(key)) return false;
      data.set(key, value);
      return true;
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

export interface UsageDelta {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function dayKey(nowIso: string): string {
  return nowIso.slice(0, 10);
}

/** The 1.3 single key per day; read only, never written again. */
function legacyUsageKey(day: string): string {
  return `usage/${day}`;
}

function ledgerPrefix(day: string): string {
  return `usage/${day}/`;
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** One ledger key; requestId must not contain '/' or '~'. */
export function ledgerKey(day: string, requestId: string, delta: UsageDelta): string {
  const id = requestId.replace(/[/~]/g, '-');
  return `${ledgerPrefix(day)}${id}~c${count(delta.costUsd * 1e6)}~i${count(delta.inputTokens)}~o${count(delta.outputTokens)}`;
}

const LEDGER_SUFFIX = /~c(\d+)~i(\d+)~o(\d+)$/;

/** The numbers a ledger key carries, or null for a key this code did not write. */
export function parseLedgerKey(key: string): UsageDelta | null {
  const match = LEDGER_SUFFIX.exec(key);
  if (!match) return null;
  return { costUsd: Number(match[1]) / 1e6, inputTokens: Number(match[2]), outputTokens: Number(match[3]) };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export async function readUsage(store: IntelStore, day: string): Promise<DailyUsage> {
  const [raw, keys] = await Promise.all([
    store.get(legacyUsageKey(day)) as Promise<Partial<DailyUsage> | null>,
    store.list(ledgerPrefix(day)),
  ]);
  let costUsd = typeof raw?.costUsd === 'number' ? raw.costUsd : 0;
  let inputTokens = typeof raw?.inputTokens === 'number' ? raw.inputTokens : 0;
  let outputTokens = typeof raw?.outputTokens === 'number' ? raw.outputTokens : 0;
  let requests = typeof raw?.requests === 'number' ? raw.requests : 0;
  for (const key of keys) {
    const entry = parseLedgerKey(key);
    if (!entry) continue;
    costUsd += entry.costUsd;
    inputTokens += entry.inputTokens;
    outputTokens += entry.outputTokens;
    requests += 1;
  }
  return { costUsd: round6(costUsd), day, inputTokens, outputTokens, requests };
}

/**
 * Records one paid call as its own ledger entry and returns the day's new
 * total. A taken key (the same request id twice) gets a suffix and is
 * written again, so a call is never silently dropped from the ledger.
 */
export async function addUsage(
  store: IntelStore,
  day: string,
  requestId: string,
  delta: UsageDelta,
  atIso: string = new Date().toISOString(),
): Promise<DailyUsage> {
  const value = { at: atIso, ...delta, costUsd: round6(delta.costUsd), requestId };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = attempt === 0 ? requestId : `${requestId}-${attempt}`;
    if (await store.setIfNew(ledgerKey(day, id, delta), value)) break;
  }
  return readUsage(store, day);
}

/** The last `days` days of usage, newest first (days with no spend included). */
export async function recentUsage(store: IntelStore, nowIso: string, days: number): Promise<DailyUsage[]> {
  const start = Date.parse(`${dayKey(nowIso)}T00:00:00Z`);
  const list: string[] = [];
  for (let i = 0; i < days; i += 1) list.push(new Date(start - i * 86_400_000).toISOString().slice(0, 10));
  return Promise.all(list.map((day) => readUsage(store, day)));
}
