// 2.0 (SSO Option B, decided 2026-11-02) — the device-key lock every function
// uses once the site is public. A paired device sends its key in the
// `X-Zanshin-Device` header; the function hashes it (SHA-256) and compares the
// hash with the env var `ZANSHIN_DEVICE_KEY_SHA256` (one hex hash, or several
// separated by commas — one per device). The key itself never reaches the
// server's environment, logs or Blobs.
//
//   no hash configured   → 503 { code: 'device-key-unset' }  (fails closed)
//   header missing/wrong → 401 { code: 'device-key' }
//
// The JSON `code` lets the app tell this 401 apart from Netlify's own sign-in
// 401 (an HTML page): a wrong key points to Settings, an expired sign-in to
// "Sign in again". First used by `ranked` (M2); `intel`, `diag` and `sync`
// adopt the same helper before the site goes public.

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

export async function verifyDeviceKey(request: Request, configured: string | undefined): Promise<DeviceKeyResult> {
  const hashes = parseDeviceKeyHashes(configured);
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
