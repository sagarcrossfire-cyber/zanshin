// 2.0 M1 — the diag function's request handler (netlify/functions/diag.mts
// wires it to Netlify Blobs), as a pure function of its dependencies so tests
// drive it with Request objects and a memory store.
//
//   POST /api/diag   one telemetry event (src/server/diag/schema.ts)
//                    → 202 { ok, stored }   400 bad JSON or schema   413 too big
//
// Each accepted event becomes one `ZT1 {…}` log line (always) and one Blobs
// entry `<YYYY-MM-DD>/<ts>-<rand>` (until the day's cap). The day is the
// server's UTC day, never the client clock. The cap is counted by listing
// the day's prefix, so there is no read-modify-write counter to race; two
// concurrent requests at the edge of the cap may both store, which is fine.
// Nothing outside the schema is logged or stored: no IP, no headers, no body.
import { DIAG_BODY_MAX, diagEventSchema } from './schema';
import { consoleZt1, zt1Line, type Zt1Logger } from './zt1';

/** About 500 stored events a day; the log line is written either way. */
export const DIAG_DAILY_CAP = 500;

export interface DiagStore {
  /** Keys that start with `prefix` (used only to count the day's events). */
  list(prefix: string): Promise<string[]>;
  /** Writes `key` only if it does not exist yet; false when it did. */
  setIfNew(key: string, value: unknown): Promise<boolean>;
}

export function memoryDiagStore(): DiagStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    async setIfNew(key, value) {
      if (data.has(key)) return false;
      data.set(key, value);
      return true;
    },
  };
}

/**
 * Blobs stores are site-wide and shared by every deploy context, so a
 * preview must never write production's store: `diag` for production,
 * `diag-<context>` otherwise, and `diag-unknown` when the runtime does not
 * say (so an unlabelled deploy can never pollute production's history).
 */
export function diagStoreName(deployContext: string | undefined): string {
  const context = (deployContext ?? '').trim().toLowerCase();
  if (context === 'production') return 'diag';
  const safe = context.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `diag-${safe === '' ? 'unknown' : safe}`;
}

export interface DiagDeps {
  /** Null when Blobs is unavailable: events are then logged but not stored. */
  store: DiagStore | null;
  log?: Zt1Logger;
  nowMs?: () => number;
  randomId?: () => string;
  dailyCap?: number;
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    status,
  });
}

function defaultRandomId(): string {
  return Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, '0');
}

export function createDiagHandler(deps: DiagDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? consoleZt1;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const randomId = deps.randomId ?? defaultRandomId;
  const cap = deps.dailyCap ?? DIAG_DAILY_CAP;

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'POST a diag event.' }, 405, { Allow: 'POST' });
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > DIAG_BODY_MAX) return json({ error: 'Event too large.' }, 413);
    let text: string;
    try {
      text = await request.text();
    } catch {
      return json({ error: 'Unreadable body.' }, 400);
    }
    if (text.length > DIAG_BODY_MAX) return json({ error: 'Event too large.' }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return json({ error: 'The body is not valid JSON.' }, 400);
    }
    const parsed = diagEventSchema.safeParse(raw);
    if (!parsed.success) {
      // Field path only: the rejected values are never echoed or logged.
      const issue = parsed.error.issues[0];
      return json({ error: `Invalid diag event: ${issue?.path.join('.') || 'body'}.` }, 400);
    }
    const event = parsed.data;
    log(zt1Line(event));

    let stored = false;
    if (deps.store) {
      const now = nowMs();
      const day = new Date(now).toISOString().slice(0, 10);
      try {
        const today = await deps.store.list(`${day}/`);
        if (today.length < cap) {
          stored = await deps.store.setIfNew(`${day}/${now}-${randomId()}`, event);
        }
      } catch (error) {
        console.warn(`diag: could not store the event (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    return json({ ok: true, stored }, 202);
  };
}
