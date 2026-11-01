// Global error reporting — spec §14.1. Global handlers for `error` and
// `unhandledrejection` write to the errors ring buffer (last 50) and show
// at most one toast per minute. Messages are sanitized: API keys and bearer
// tokens are redacted before anything is stored or shown, so a secret can
// never leak into Diagnostics, a copied error, or a toast (AC-COACH-3).
//
// 2.0 M1 — telemetry. Every recorded error is also queued as one event for
// the site's diag function (POST /api/diag, netlify/functions/diag.mts) so
// production problems can be traced without Sagar copying anything. Events
// follow the schema shared with the function (src/server/diag/schema.ts):
// sanitized error text and stack (2 KB each), the route, release, schema
// version, a coarse device class and a per-launch session id. Never
// IndexedDB content (notes, match logs, coach text) and never keys. Rules:
//   - Settings → Data "Send error reports…" (settings.telemetry, default on)
//     decides; the choice is mirrored to localStorage so it is known before
//     IndexedDB opens. Until it is known, events wait in memory.
//   - One event per fingerprint per session, at most 50 per session.
//   - Sent with navigator.sendBeacon (fetch keepalive as the fallback);
//     offline or refused events wait in a small in-memory queue (20) and go
//     when the device is back online. Nothing is written to IndexedDB.
//   - A boot self-test event once per new release (runBootSelfTest).
//   - Only on the site itself: a local server (dev, preview, e2e) has no
//     diag or intel function, so events stay in memory there and the boot
//     self-test is skipped (siteHostsDiag).
import { errorsRepo } from '../data/repos';
import { DIAG_TEXT_MAX, diagEventSchema, type DiagEvent, type DiagKind, type IntelHealthState } from '../server/diag/schema';

const TOAST_MIN_INTERVAL_MS = 60_000;
const MAX_MESSAGE_LENGTH = 2000;

let lastToastAt = 0;

export function sanitizeErrorText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}['"]?/gi, 'api-key=[redacted]')
    .slice(0, MAX_MESSAGE_LENGTH);
}

/** Error text for telemetry: sanitized, long quoted strings (which could be
 * a note or a coach answer echoed by an error) replaced, at most 2 KB. */
export function telemetryText(text: string): string {
  return sanitizeErrorText(text)
    .replace(/(["'`])[^"'`\n]{48,}\1/g, '$1[text]$1')
    .slice(0, DIAG_TEXT_MAX);
}

export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: sanitizeErrorText(error.message) };
  return { name: 'Error', message: sanitizeErrorText(String(error)) };
}

/** QuotaExceededError (or Dexie's QuotaExceeded wrapper): storage is full. */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return true;
    // Dexie wraps some DOMExceptions; the message still names the quota.
    if (/quota/i.test(error.message) && /exceed/i.test(error.message)) return true;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError';
  }
  return false;
}

export function storageFullMessage(): string {
  return 'Storage is full — nothing was lost. Export a backup, then remove old snapshots in Settings to free space.';
}

/**
 * Write an error record to the ring buffer without any toast. Used by the
 * per-route error boundary, which shows its own screen.
 */
export function recordError(where: string, error: unknown, nowMs: number = Date.now()): void {
  const { name, message } = describeError(error);
  const text = isQuotaError(error) ? storageFullMessage() : `${name}: ${message}`;
  void errorsRepo
    .put({
      at: new Date(nowMs).toISOString(),
      id: `err-${nowMs}-${Math.floor(Math.random() * 1e6)}`,
      message: `[${where}] ${text}`,
      where,
    })
    .catch(() => {
      // The errors table itself is unavailable (e.g. storage full): swallow.
    });
  try {
    queueTelemetry(telemetryKindFor(where, error), where, error, nowMs);
  } catch {
    // Telemetry must never throw into the code that reported the error.
  }
}

/**
 * Record an unexpected error and decide whether a toast may be shown.
 * Returns the (sanitized) message to show, or null when the one-per-minute
 * throttle suppresses the toast. The write is fire-and-forget: reporting
 * must never throw into the handler that called it.
 */
export function reportUnexpectedError(
  where: string,
  error: unknown,
  nowMs: number = Date.now(),
): string | null {
  recordError(where, error, nowMs);
  const { name, message } = describeError(error);
  const text = isQuotaError(error) ? storageFullMessage() : `${name}: ${message}`;
  if (nowMs - lastToastAt < TOAST_MIN_INTERVAL_MS) return null;
  lastToastAt = nowMs;
  return text;
}

/** Test helper: resets the toast throttle. */
export function resetErrorThrottleForTests(): void {
  lastToastAt = 0;
}

// --- Telemetry (2.0 M1) ------------------------------------------------------

export const DIAG_URL = '/api/diag';
/** localStorage mirror of settings.telemetry: '1' on, '0' off. */
export const TELEMETRY_PREF_KEY = 'zanshin.telemetry';
/** localStorage: the release the boot self-test last ran for. */
export const SELFTEST_MARKER_KEY = 'zanshin.selftest.release';
const QUEUE_MAX = 20;
const SESSION_EVENT_MAX = 50;
/** When settings never load (IndexedDB broken), the default (on) applies. */
const PENDING_FALLBACK_MS = 15_000;

type TelemetryMode = 'pending' | 'on' | 'off';
/** Sends one JSON body; true when it left (or should not be retried). */
export type TelemetryTransport = (body: string) => Promise<boolean>;

export interface TelemetryOptions {
  release: string;
  schema: number;
  deviceLabel?: string;
  transport?: TelemetryTransport;
  online?: () => boolean;
  route?: () => string;
  userAgent?: string;
  touchPoints?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

interface TelemetryState {
  mode: TelemetryMode;
  release: string;
  schema: number;
  deviceLabel?: string;
  sessionId: string;
  uaClass: string;
  queue: DiagEvent[];
  seen: Set<string>;
  accepted: number;
  flushing: boolean;
  idbOpenMs?: number;
  transport: TelemetryTransport;
  online: () => boolean;
  route: () => string;
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;
}

function randomSessionId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to Math.random.
  }
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1_0000_0000).toString(36)}`;
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function browserRoute(): string {
  try {
    const path = typeof location === 'undefined' ? '/' : location.pathname.slice(0, 200);
    return /^\/[^?#\s]*$/.test(path) ? path : '/';
  } catch {
    return '/';
  }
}

/**
 * True when this page is served by the Netlify site, which has the diag and
 * intel functions; false on localhost / 127.0.0.1 (dev, preview, e2e) and
 * file:// (the standalone build), where posting would only produce 404s.
 */
export function siteHostsDiag(loc: Pick<Location, 'protocol' | 'hostname'> | undefined = typeof location === 'undefined' ? undefined : location): boolean {
  if (!loc || !/^https?:$/.test(loc.protocol)) return false;
  const host = loc.hostname.toLowerCase();
  return !/^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)$/.test(host) && !host.endsWith('.localhost');
}

/** Keeps events queued: used where no diag function exists. */
const offSiteTransport: TelemetryTransport = async () => false;

/** sendBeacon first; fetch keepalive when the beacon is refused or missing. */
export const beaconTransport: TelemetryTransport = async (body) => {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return false;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(DIAG_URL, new Blob([body], { type: 'application/json' }))) {
      return true;
    }
  } catch {
    // Fall back to fetch.
  }
  try {
    const response = await fetch(DIAG_URL, {
      body,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    });
    // A 400 means the event itself is bad: retrying would not help.
    return response.ok || response.status === 400 || response.status === 413;
  } catch {
    return false;
  }
};

function freshState(): TelemetryState {
  return {
    accepted: 0,
    flushing: false,
    mode: 'pending',
    online: browserOnline,
    queue: [],
    release: 'unknown',
    route: browserRoute,
    schema: 0,
    seen: new Set(),
    sessionId: randomSessionId(),
    storage: browserStorage,
    transport: beaconTransport,
    uaClass: uaClassOf(typeof navigator === 'undefined' ? '' : navigator.userAgent ?? '', typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints ?? 0),
  };
}

let telemetry: TelemetryState = freshState();
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let onlineListener: (() => void) | undefined;

/** "phone-chrome", "desktop-firefox", … — never the full user agent. */
export function uaClassOf(userAgent: string, touchPoints = 0): string {
  const ua = userAgent.toLowerCase();
  const form = /ipad|tablet/.test(ua) || (/macintosh/.test(ua) && touchPoints > 1) || (/android/.test(ua) && !/mobile/.test(ua))
    ? 'tablet'
    : /mobi|iphone|ipod|android/.test(ua) ? 'phone' : 'desktop';
  const browser = /edg(e|a|ios)?\//.test(ua) ? 'edge'
    : /samsungbrowser/.test(ua) ? 'samsung'
      : /firefox|fxios/.test(ua) ? 'firefox'
        : /crios|chrome|chromium/.test(ua) ? 'chrome'
          : /safari/.test(ua) ? 'safari' : 'other';
  return `${form}-${browser}`;
}

/** The first stack line that names a source position, without query strings. */
export function topFrame(stack: string | undefined): string {
  if (!stack) return '';
  for (const line of stack.split('\n')) {
    if (/:\d+:\d+/.test(line)) return line.trim().replace(/\?[^\s:)]*/g, '').slice(0, 300);
  }
  return '';
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 16 hex characters from two FNV-1a passes; stable across sessions. */
export function fingerprintOf(parts: string[]): string {
  const text = parts.join('|');
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x01000193);
}

const IDB_ERROR_NAMES = /^(DatabaseClosed|OpenFailed|Version|Upgrade|MissingAPI|InvalidTable|Schema|InvalidState)Error$/;

/** Which kind of problem a recorded error is, from where it was caught. */
export function telemetryKindFor(where: string, error: unknown): DiagKind {
  if (isQuotaError(error)) return 'quota';
  if (where === 'window.unhandledrejection') return 'unhandledrejection';
  if (/^(pwa|siteAccess|sw)\./.test(where)) return 'sw';
  if (/^(migrate|bootstrap|idb|db)\./.test(where) || (error instanceof Error && IDB_ERROR_NAMES.test(error.name))) return 'idb';
  if (/^(intel|research|coach)\./.test(where)) return 'intel';
  if (/^sync\./.test(where)) return 'sync';
  return 'error';
}

/** Sets the release, schema and (for tests) transport; call once at boot. */
export function configureTelemetry(options: TelemetryOptions): void {
  telemetry.release = options.release;
  telemetry.schema = options.schema;
  telemetry.deviceLabel = options.deviceLabel;
  telemetry.transport = options.transport ?? (siteHostsDiag() ? beaconTransport : offSiteTransport);
  if (options.online) telemetry.online = options.online;
  if (options.route) telemetry.route = options.route;
  if (options.storage !== undefined) {
    const storage = options.storage;
    telemetry.storage = () => storage;
  }
  if (options.userAgent !== undefined) telemetry.uaClass = uaClassOf(options.userAgent, options.touchPoints ?? 0);
  // Re-stamp anything queued before the release was known.
  for (const event of telemetry.queue) {
    event.release = telemetry.release;
    event.schema = telemetry.schema;
  }
  if (telemetry.mode === 'pending') {
    let mirrored: string | null = null;
    try {
      mirrored = telemetry.storage()?.getItem(TELEMETRY_PREF_KEY) ?? null;
    } catch {
      mirrored = null;
    }
    if (mirrored === '0') setTelemetryEnabled(false);
    else if (mirrored === '1') setTelemetryEnabled(true);
    else {
      if (pendingTimer !== undefined) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        if (telemetry.mode === 'pending') setTelemetryEnabled(true);
      }, PENDING_FALLBACK_MS);
    }
  }
  if (onlineListener === undefined && typeof window !== 'undefined') {
    onlineListener = () => {
      void flushTelemetry();
    };
    window.addEventListener('online', onlineListener);
  }
}

/** Applies Settings' choice: on sends the queue, off drops it. */
export function setTelemetryEnabled(enabled: boolean): void {
  const next: TelemetryMode = enabled ? 'on' : 'off';
  if (pendingTimer !== undefined) {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
  try {
    telemetry.storage()?.setItem(TELEMETRY_PREF_KEY, enabled ? '1' : '0');
  } catch {
    // The mirror is a convenience; Settings stays the source of truth.
  }
  if (telemetry.mode === next) return;
  telemetry.mode = next;
  if (next === 'off') telemetry.queue = [];
  else void flushTelemetry();
}

export function telemetryEnabled(): boolean {
  return telemetry.mode === 'on';
}

/** IndexedDB open time at boot (first repository read), for the self-test. */
export function setBootIdbOpenMs(ms: number): void {
  if (telemetry.idbOpenMs === undefined && Number.isFinite(ms) && ms >= 0) telemetry.idbOpenMs = Math.round(ms);
}

function enqueue(event: DiagEvent): boolean {
  if (telemetry.mode === 'off') return false;
  if (telemetry.seen.has(event.fingerprint) || telemetry.accepted >= SESSION_EVENT_MAX) return false;
  const parsed = diagEventSchema.safeParse(event);
  if (!parsed.success) return false;
  telemetry.seen.add(event.fingerprint);
  telemetry.accepted += 1;
  telemetry.queue.push(parsed.data);
  if (telemetry.queue.length > QUEUE_MAX) telemetry.queue.splice(0, telemetry.queue.length - QUEUE_MAX);
  void flushTelemetry();
  return true;
}

function baseEvent(kind: DiagKind, fingerprint: string, message: string, nowMs: number): DiagEvent {
  return {
    at: new Date(nowMs).toISOString(),
    fingerprint,
    kind,
    message: telemetryText(message),
    online: telemetry.online(),
    release: telemetry.release,
    route: telemetry.route(),
    schema: telemetry.schema,
    sessionId: telemetry.sessionId,
    uaClass: telemetry.uaClass,
    ...(telemetry.deviceLabel ? { deviceLabel: telemetry.deviceLabel } : {}),
  };
}

/** Queues one sanitized event for an error; false when deduped, capped or off. */
export function queueTelemetry(kind: DiagKind, where: string, error: unknown, nowMs: number = Date.now()): boolean {
  if (telemetry.mode === 'off') return false;
  const { name, message } = describeError(error);
  const stack = error instanceof Error && typeof error.stack === 'string' ? telemetryText(error.stack) : undefined;
  const fingerprint = fingerprintOf([kind, where, name, topFrame(stack) || message.replace(/\d+/g, '0').slice(0, 120)]);
  const event = baseEvent(kind, fingerprint, `[${where}] ${name}: ${message}`, nowMs);
  if (stack) event.stack = stack;
  return enqueue(event);
}

/** Sends what is queued, oldest first; stops at the first refusal and keeps the rest. */
export async function flushTelemetry(): Promise<void> {
  if (telemetry.flushing || telemetry.mode !== 'on' || !telemetry.online()) return;
  telemetry.flushing = true;
  const state = telemetry;
  try {
    while (state.mode === 'on' && state.queue.length > 0) {
      const event = state.queue[0] as DiagEvent;
      let sent = false;
      try {
        sent = await state.transport(JSON.stringify(event));
      } catch {
        sent = false;
      }
      if (!sent) break;
      state.queue.shift();
    }
  } finally {
    state.flushing = false;
  }
}

export interface BootSelfTestDeps {
  release: string;
  /** The intel function's health route (services/intel.ts intelHealth). */
  health: () => Promise<unknown>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  nowMs?: number;
}

/** Maps the health answer (or its failure) to a state; never throws. */
export async function intelHealthState(health: () => Promise<unknown>): Promise<IntelHealthState> {
  try {
    const answer = (await health()) as { ok?: unknown; keyConfigured?: unknown; durableStore?: unknown } | null;
    if (answer === null || typeof answer !== 'object' || answer.ok !== true) return 'missing';
    if (answer.keyConfigured !== true) return 'no-key';
    if (answer.durableStore === false) return 'no-blobs';
    return 'ok';
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 401 || status === 403) return 'signed-out';
    if (status === 0) return 'offline';
    if (status === 404) return 'missing';
    return 'error';
  }
}

/**
 * The real smoke test, run in Sagar's signed-in browser: on the first open of
 * a new release, ask the intel function for health and post one
 * `boot-selftest` event with what it found and the IndexedDB open time.
 * Once per release per browser (a localStorage marker); skipped when
 * telemetry is off.
 */
export async function runBootSelfTest(deps: BootSelfTestDeps): Promise<'queued' | 'skipped'> {
  if (telemetry.mode === 'off') return 'skipped';
  const storage = deps.storage !== undefined ? deps.storage : telemetry.storage();
  try {
    if (storage?.getItem(SELFTEST_MARKER_KEY) === deps.release) return 'skipped';
  } catch {
    // No storage: run, and accept running again next launch.
  }
  const intel = await intelHealthState(deps.health);
  const idbOpenMs = telemetry.idbOpenMs;
  const message = `Boot self-test ${deps.release}: intel ${intel}${idbOpenMs !== undefined ? `, IndexedDB open ${idbOpenMs} ms` : ''}`;
  const event = baseEvent('boot-selftest', fingerprintOf(['boot-selftest', deps.release]), message, deps.nowMs ?? Date.now());
  event.checks = { intel, ...(idbOpenMs !== undefined ? { idbOpenMs } : {}) };
  enqueue(event);
  try {
    storage?.setItem(SELFTEST_MARKER_KEY, deps.release);
  } catch {
    // As above.
  }
  return 'queued';
}

/** Test helper: a fresh telemetry state (pending, empty queue, new session). */
export function resetTelemetryForTests(): void {
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  pendingTimer = undefined;
  if (onlineListener !== undefined && typeof window !== 'undefined') window.removeEventListener('online', onlineListener);
  onlineListener = undefined;
  telemetry = freshState();
}

/** Test helper: what is waiting to be sent. */
export function telemetryQueueForTests(): DiagEvent[] {
  return [...telemetry.queue];
}
