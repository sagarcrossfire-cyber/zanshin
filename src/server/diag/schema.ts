// 2.0 M1 — the telemetry event, shared by the diag function
// (netlify/functions/diag.mts via src/server/diag/handler.ts) and the app
// (src/services/errorReport.ts builds and checks events with it before they
// leave the device). One schema, so the two sides cannot drift.
//
// What an event may carry is exactly this list (docs/v2/research/infra.md §4):
// the error text and stack (sanitized, at most 2 KB each), where in the app it
// happened, which release and schema, a coarse device class and per-launch
// session id. Never IndexedDB content (notes, match logs, coach text), never
// keys, never the IP (Netlify already records it). Unknown fields are
// stripped by the parser, so nothing outside this list is logged or stored.
import { z } from 'zod';

export const DIAG_KINDS = ['error', 'unhandledrejection', 'sw', 'idb', 'quota', 'intel', 'sync', 'boot-selftest', 'perf'] as const;
export type DiagKind = (typeof DIAG_KINDS)[number];

/** 2 KB: the most text one field may carry. */
export const DIAG_TEXT_MAX = 2048;
/** The diag function refuses bodies larger than this before parsing them. */
export const DIAG_BODY_MAX = 8192;

/** What the boot self-test found when it asked the intel function for health. */
export const INTEL_HEALTH_STATES = ['ok', 'no-key', 'no-blobs', 'signed-out', 'offline', 'missing', 'error'] as const;
export type IntelHealthState = (typeof INTEL_HEALTH_STATES)[number];

/** Boot self-test results; numbers and states only, never text. */
export const diagChecksSchema = z.object({
  idbOpenMs: z.number().nonnegative().max(600_000).optional(),
  intel: z.enum(INTEL_HEALTH_STATES).optional(),
});

export const diagEventSchema = z.object({
  kind: z.enum(DIAG_KINDS),
  /** App release (APP_VERSION). */
  release: z.string().min(1).max(40).regex(/^[0-9A-Za-z.+-]+$/),
  /** IndexedDB schema version. */
  schema: z.number().int().nonnegative().max(1000),
  /** location.pathname only: no query string, no hash. */
  route: z.string().min(1).max(200).regex(/^\/[^?#\s]*$/),
  /** A label Sagar chooses for the device ("pc", "phone"). */
  deviceLabel: z.string().min(1).max(24).regex(/^[\w -]+$/).optional(),
  /** Coarse class such as "phone-chrome" or "desktop-firefox", never the full user agent. */
  uaClass: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  online: z.boolean(),
  /** Random per launch; ties one session's events together. */
  sessionId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  /** Hash of where + error name + top stack frame; the dedupe key. */
  fingerprint: z.string().regex(/^[0-9a-f]{8,64}$/),
  message: z.string().max(DIAG_TEXT_MAX),
  stack: z.string().max(DIAG_TEXT_MAX).optional(),
  /** Client clock; the function files events by its own clock. */
  at: z.string().datetime(),
  checks: diagChecksSchema.optional(),
});
export type DiagEvent = z.infer<typeof diagEventSchema>;
