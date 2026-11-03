// 2.0 (SSO Option B, decided 2026-11-02) — the device-key lock every function
// uses once the site is public. A paired device sends its key in the
// `X-Zanshin-Device` header; the function hashes it (SHA-256) and compares the
// hash against the allow-list `allowedDeviceKeyHashes()` builds: the env var
// `ZANSHIN_DEVICE_KEY_SHA256` (one hex hash, or several separated by commas —
// one per device) union the hash the sync store learned at pairing
// (`v1/devicekeyhash`, src/server/sync/schema.ts — sync pairing registers it,
// so a fresh site needs no manual hash step or extra deploy; see card
// sso-b-lock). The key itself never reaches the server's environment, logs or
// Blobs — only its hash.
//
//   no hash configured   → 503 { code: 'device-key-unset' }  (fails closed)
//   header missing/wrong → 401 { code: 'device-key' }
//
// The JSON `code` lets the app tell this 401 apart from Netlify's own sign-in
// 401 (an HTML page): a wrong key points to Settings, an expired sign-in to
// "Sign in again". Used by `ranked`, `intel` and `diag` (sync keeps its own
// X-Zanshin-Sync auth, unchanged).

import { V1_DEVICEKEYHASH_KEY } from './sync/schema';

export const DEVICE_KEY_HEADER = 'x-zanshin-device';
export const DEVICE_KEY_ENV = 'ZANSHIN_DEVICE_KEY_SHA256';

export type DeviceKeyResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: 'device-key' | 'device-key-unset'; message: string };

const HEX64 = /^[0-9a-f]{64}$/;

/** The configured hashes (lowercased, blanks and malformed entries dropped). */
export function parseDeviceKeyHashes(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw.split(',').map((part) => part.trim().toLowerCase()).filter((part) => HEX64.test(part));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two equal-length hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Minimal read-only view of the sync store this module needs — just enough
 * to read `v1/devicekeyhash` (src/server/sync/schema.ts). ranked/intel/diag
 * pass their sync Blobs store (scoped exactly like netlify/functions/sync.mts). */
export interface DeviceKeyHashStore {
  get(key: string): Promise<string | null>;
}

/**
 * The allow-list a locked function checks against: the configured env
 * hashes union the one hash sync pairing registered in the sync store
 * (`v1/devicekeyhash`, written once, never overwritten — src/server/sync/
 * handler.ts POST init). A store read failure (or no store at all, e.g.
 * Blobs unavailable) falls back to env hashes only; a malformed stored value
 * is ignored rather than trusted.
 */
export async function allowedDeviceKeyHashes(
  envValue: string | undefined,
  syncStore: DeviceKeyHashStore | null,
): Promise<string[]> {
  const envHashes = parseDeviceKeyHashes(envValue);
  if (syncStore === null) return envHashes;
  try {
    const stored = await syncStore.get(V1_DEVICEKEYHASH_KEY);
    if (stored === null) return envHashes;
    const hash = stored.trim().toLowerCase();
    if (!HEX64.test(hash)) return envHashes;
    return envHashes.includes(hash) ? envHashes : [...envHashes, hash];
  } catch {
    return envHashes;
  }
}

export async function verifyDeviceKey(request: Request, hashes: string[]): Promise<DeviceKeyResult> {
  if (hashes.length === 0) {
    return {
      ok: false, status: 503, code: 'device-key-unset',
      message: 'This function is locked to paired devices, and no device key is configured on the server yet.',
    };
  }
  const key = (request.headers.get(DEVICE_KEY_HEADER) ?? '').trim();
  if (key.length < 16 || key.length > 256) {
    return { ok: false, status: 401, code: 'device-key', message: 'This device has no valid device key.' };
  }
  const hash = await sha256Hex(key);
  let match = false;
  for (const expected of hashes) match = sameHex(hash, expected) || match;
  return match
    ? { ok: true }
    : { ok: false, status: 401, code: 'device-key', message: 'This device has no valid device key.' };
}
