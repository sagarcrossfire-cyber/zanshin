// 2.0 M3 — the /api/sync wire contract: route bodies, key formats and size
// limits, shared by the function's request handler (src/server/sync/handler.ts)
// and its unit tests. The server never sees plaintext: every log/snap body is
// an opaque `v1.<iv>.<ct>` string produced on-device (src/services/sync*, a
// later M3 card); this module only validates shape and size.
//
// Key layout under the `sync` Blobs store (src/server/storeName.ts scopes the
// store name per deploy context):
//   v1/verifier            — SHA-256(authKey) hex, written once at pairing
//   v1/devicekeyhash        — SHA-256(deviceKey) hex, written once at pairing
//                             (onlyIfNew, same POST init as the verifier; never
//                             overwritten). Read by src/server/deviceKey.ts
//                             (allowedDeviceKeyHashes) so ranked/intel/diag can
//                             lock to a paired device with no env var and no
//                             extra deploy — SSO Option B, card sso-b-lock.
//   v1/log/<deviceId>/<hlc>  — one encrypted batch from writer <deviceId>, write-once
//   v1/snap/<hlc>           — an encrypted full-state snapshot (ciphertext only)
//   v1/snapmeta/<hlc>       — that snapshot's per-writer cursor (plaintext JSON,
//                             device IDs and HLCs only — no payload)
//   v1/ack/<deviceId>       — that device's per-writer read cursor (plaintext JSON)
//
// `<hlc>` is the wire format for a hybrid logical clock entry, produced by
// `tick`/`formatHlc` in src/domain/sync/hlc.ts (2.0 M3, landed PR #54):
// `<13-digit wall-clock ms>-<4-digit counter>-<deviceId>`, the wall/counter
// fields zero-padded so two hlcs sort lexically in time order (deviceId only
// breaks a tie on the same wall-ms/counter). This schema mirrors that format
// exactly (HLC_RE) so the server accepts what the client actually sends.
//
// Per-writer cursors (protocol correction, PR #52 review). Log keys sort by
// device first (`v1/log/<deviceId>/<hlc>`), so one global cursor across every
// writer skips entries once it lands inside another device's key range —
// log keys sort as strings, not as a merged timeline. Every cursor in this
// protocol (a reader's `GET log` position, an `ack`'s `through`, a
// snapshot's bootstrap point) is therefore a *map of writerId → hlc*, one
// independent cursor per writer, never a single key spanning writers.
import { z } from 'zod';

export const SYNC_AUTH_HEADER = 'x-zanshin-sync';

/** authKey is base64url, produced by HKDF on-device; bound generously since the server never decodes it, only hashes it. */
export const AUTH_KEY_RE = /^[A-Za-z0-9_-]{16,512}$/;

export const VERIFIER_RE = /^[0-9a-f]{64}$/;

/** SHA-256(deviceKey) hex, the same shape as the verifier (src/server/deviceKey.ts HEX64). */
export const DEVICE_KEY_HASH_RE = /^[0-9a-f]{64}$/;

export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** `<13-digit wall ms>-<4-digit counter>-<deviceId>`; mirrors src/domain/sync/hlc.ts formatHlc/tick. */
export const HLC_RE = /^[0-9]{13}-[0-9]{4}-[A-Za-z0-9_-]{1,64}$/;

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
export const V1_DEVICEKEYHASH_KEY = 'v1/devicekeyhash';
export const V1_LOG_PREFIX = 'v1/log/';
export const V1_SNAP_PREFIX = 'v1/snap/';
export const V1_SNAPMETA_PREFIX = 'v1/snapmeta/';
export const V1_ACK_PREFIX = 'v1/ack/';

export function logKey(deviceId: string, hlc: string): string {
  return `${V1_LOG_PREFIX}${deviceId}/${hlc}`;
}

/** Every log key written by one device lives under this prefix, in ascending hlc order. */
export function logPrefixFor(deviceId: string): string {
  return `${V1_LOG_PREFIX}${deviceId}/`;
}

export function snapKey(hlc: string): string {
  return `${V1_SNAP_PREFIX}${hlc}`;
}

/** The per-writer cursor a snapshot at `hlc` covers — deleted together with its snapshot. */
export function snapMetaKey(hlc: string): string {
  return `${V1_SNAPMETA_PREFIX}${hlc}`;
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

/** The deviceId segment of a `v1/log/<deviceId>/<hlc>` key, or null if it is not one. */
export function deviceIdOfLogKey(key: string): string | null {
  if (!key.startsWith(V1_LOG_PREFIX)) return null;
  const rest = key.slice(V1_LOG_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const deviceId = rest.slice(0, slash);
  return DEVICE_ID_RE.test(deviceId) ? deviceId : null;
}

/** The hlc segment of a `v1/snap/<hlc>` key, or null if it is not one. */
export function hlcOfSnapKey(key: string): string | null {
  if (!key.startsWith(V1_SNAP_PREFIX)) return null;
  const hlc = key.slice(V1_SNAP_PREFIX.length);
  return HLC_RE.test(hlc) ? hlc : null;
}

/** A per-writer cursor: writerId → the newest hlc it covers. */
export type CursorMap = Record<string, string>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses an unknown JSON value into a CursorMap, or null if any key/value is malformed. */
export function parseCursorMap(raw: unknown): CursorMap | null {
  if (!isPlainObject(raw)) return null;
  const result: CursorMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DEVICE_ID_RE.test(key) || typeof value !== 'string' || !HLC_RE.test(value)) return null;
    result[key] = value;
  }
  return result;
}

/** Merges `incoming` into `existing`, keeping the max hlc per writer — an ack can never move backwards. */
export function mergeCursorMax(existing: CursorMap, incoming: CursorMap): CursorMap {
  const merged: CursorMap = { ...existing };
  for (const [writerId, hlc] of Object.entries(incoming)) {
    const current = merged[writerId];
    if (current === undefined || hlc > current) merged[writerId] = hlc;
  }
  return merged;
}

export const initBodySchema = z.object({
  verifier: z.string().regex(VERIFIER_RE),
  /** SHA-256(deviceKey), sent once by the pairing device (pairNew); the
   * joiner derives the same device key locally and sends nothing. Stored
   * onlyIfNew (never overwritten) — see the POST init route. */
  deviceKeyHash: z.string().regex(DEVICE_KEY_HASH_RE).optional(),
});

/** `through` is validated as a CursorMap by parseCursorMap, not by zod (arbitrary key set). */
export const ackBodySchema = z.object({
  deviceId: z.string().regex(DEVICE_ID_RE),
  through: z.unknown(),
});

export const logQuerySchema = z.object({
  device: z.string().regex(DEVICE_ID_RE),
  after: z.string().regex(HLC_RE).optional(),
  limit: z.coerce.number().int().min(LOG_PAGE_LIMIT_MIN).max(LOG_PAGE_LIMIT_MAX).optional(),
});

/** `cursor` is validated as a CursorMap by parseCursorMap, not by zod (arbitrary key set). */
export const snapBodySchema = z.object({
  cursor: z.unknown(),
  data: z.string().min(1),
});

export const SYNC_ERROR_CODES = [
  'bad-request', 'sync-auth', 'sync-unpaired', 'conflict', 'too-large', 'sync-store', 'not-found',
] as const;
export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export interface SyncDevice {
  deviceId: string;
  /** This device's per-writer read cursor: writerId → newest hlc it has acked. */
  acked: CursorMap;
}

export interface SyncSnapInfo {
  hlc: string;
  /** The per-writer cursor this snapshot covers. */
  cursor: CursorMap;
}

export interface SyncStateOk {
  hasVerifier: boolean;
  latestSnap?: SyncSnapInfo;
  devices: SyncDevice[];
}

export interface SyncLogEntry {
  hlc: string;
  body: string;
}

export interface SyncLogPage {
  entries: SyncLogEntry[];
  next?: string;
}
