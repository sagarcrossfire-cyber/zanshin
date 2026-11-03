// 2.0 M3 — the /api/sync wire contract: route bodies, key formats and size
// limits, shared by the function's request handler (src/server/sync/handler.ts)
// and its unit tests. The server never sees plaintext: every log/snap body is
// an opaque `v1.<iv>.<ct>` string produced on-device (src/services/sync*, a
// later M3 card); this module only validates shape and size.
//
// Key layout under the `sync` Blobs store (src/server/storeName.ts scopes the
// store name per deploy context):
//   v1/verifier          — SHA-256(authKey) hex, written once at pairing
//   v1/log/<deviceId>/<hlc>  — one encrypted batch, write-once per device
//   v1/snap/<hlc>         — an encrypted full-state snapshot, newest 3 kept
//   v1/ack/<deviceId>     — the newest `v1/log/...` key that device has read
//
// `<hlc>` here is the wire format for a hybrid logical clock entry:
// `<13-digit wall-clock ms>-<1-8 hex counter>`, zero-padded so two hlcs from
// the same device sort lexically in time order. src/domain/sync/hlc.ts (a
// later M3 client card) is expected to emit exactly this shape; this schema
// is the server-side source of truth for it until that file lands.
import { z } from 'zod';

export const SYNC_AUTH_HEADER = 'x-zanshin-sync';

/** authKey is base64url, produced by HKDF on-device; bound generously since the server never decodes it, only hashes it. */
export const AUTH_KEY_RE = /^[A-Za-z0-9_-]{16,512}$/;

export const VERIFIER_RE = /^[0-9a-f]{64}$/;

export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** `<13-digit wall ms>-<1-8 hex counter>`; mirrors src/domain/sync/hlc.ts. */
export const HLC_RE = /^[0-9]{13}-[0-9a-f]{1,8}$/;

export function logKeyRe(): RegExp {
  return /^v1\/log\/[A-Za-z0-9_-]{8,32}\/[0-9]{13}-[0-9a-f]{1,8}$/;
}

export const LOG_BODY_MAX = 1_000_000;
export const SNAP_BODY_MAX = 5_000_000;
/** init/ack bodies are a few fields of plain JSON; this is a generous DoS guard, not a protocol limit. */
export const SMALL_BODY_MAX = 4_096;
/** The GET log page is kept under this many bytes of entry payload (card: "< 5 MB"). */
export const LOG_PAGE_BUDGET = 5_000_000;
export const LOG_PAGE_LIMIT_MIN = 1;
export const LOG_PAGE_LIMIT_MAX = 200;
export const LOG_PAGE_LIMIT_DEFAULT = 100;
/** Snapshots kept after a successful write. */
export const SNAP_RETENTION = 3;

export const V1_VERIFIER_KEY = 'v1/verifier';
export const V1_LOG_PREFIX = 'v1/log/';
export const V1_SNAP_PREFIX = 'v1/snap/';
export const V1_ACK_PREFIX = 'v1/ack/';

export function logKey(deviceId: string, hlc: string): string {
  return `${V1_LOG_PREFIX}${deviceId}/${hlc}`;
}

export function snapKey(hlc: string): string {
  return `${V1_SNAP_PREFIX}${hlc}`;
}

export function ackKey(deviceId: string): string {
  return `${V1_ACK_PREFIX}${deviceId}`;
}

/** The hlc segment of a `v1/log/<deviceId>/<hlc>` key, or null if it is not one. */
export function hlcOfLogKey(key: string): string | null {
  if (!key.startsWith(V1_LOG_PREFIX)) return null;
  const rest = key.slice(V1_LOG_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const hlc = rest.slice(slash + 1);
  return HLC_RE.test(hlc) ? hlc : null;
}

/** The hlc segment of a `v1/snap/<hlc>` key, or null if it is not one. */
export function hlcOfSnapKey(key: string): string | null {
  if (!key.startsWith(V1_SNAP_PREFIX)) return null;
  const hlc = key.slice(V1_SNAP_PREFIX.length);
  return HLC_RE.test(hlc) ? hlc : null;
}

/** The deviceId segment of a `v1/log/<deviceId>/<hlc>` key, or null if it is not one. */
export function deviceIdOfLogKey(key: string): string | null {
  if (!key.startsWith(V1_LOG_PREFIX)) return null;
  const rest = key.slice(V1_LOG_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const deviceId = rest.slice(0, slash);
  return DEVICE_ID_RE.test(deviceId) ? deviceId : null;
}

export const initBodySchema = z.object({
  verifier: z.string().regex(VERIFIER_RE),
});

export const ackBodySchema = z.object({
  deviceId: z.string().regex(DEVICE_ID_RE),
  through: z.string().regex(logKeyRe()),
});

export const logQuerySchema = z.object({
  after: z.string().regex(logKeyRe()).optional(),
  limit: z.coerce.number().int().min(LOG_PAGE_LIMIT_MIN).max(LOG_PAGE_LIMIT_MAX).optional(),
});

export const SYNC_ERROR_CODES = ['bad-request', 'sync-auth', 'sync-unpaired', 'conflict', 'too-large', 'sync-store'] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export interface SyncDevice {
  deviceId: string;
  ackedThrough?: string;
}

export interface SyncStateOk {
  hasVerifier: boolean;
  latestSnap?: string;
  devices: SyncDevice[];
}

export interface SyncLogEntry {
  key: string;
  body: string;
}

export interface SyncLogPage {
  entries: SyncLogEntry[];
  next?: string;
}
