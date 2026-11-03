// 2.0 M2 — the paired device's key for ranked sync (SSO Option B,
// src/server/deviceKey.ts verifies it). Stored in localStorage, never
// IndexedDB: the key must never enter a backup export, a future sync
// payload or an error report, and localStorage is the one store none of
// those read. One key per browser/device — pairing is done once per device.
//
// Storage access is wrapped in try/catch everywhere: a private/incognito
// window can throw on any localStorage call, and that must never crash the
// caller (Settings, rankedSync).
const DEVICE_KEY_STORAGE_KEY = 'zanshin.deviceKey';
export const DEVICE_KEY_MIN_LENGTH = 16;
export const DEVICE_KEY_MAX_LENGTH = 256;

function isValidLength(trimmed: string): boolean {
  return trimmed.length >= DEVICE_KEY_MIN_LENGTH && trimmed.length <= DEVICE_KEY_MAX_LENGTH;
}

/** The stored device key (trimmed), or null when unset, invalid or storage is unavailable. */
export function getDeviceKey(): string | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (raw === null) return null;
    const trimmed = raw.trim();
    return isValidLength(trimmed) ? trimmed : null;
  } catch {
    return null;
  }
}

/** Validates and stores the device key. Returns false (storage untouched) when the
 * key is outside 16–256 characters after trimming, or storage is unavailable. */
export function setDeviceKey(raw: string): boolean {
  const trimmed = raw.trim();
  if (!isValidLength(trimmed)) return false;
  try {
    localStorage.setItem(DEVICE_KEY_STORAGE_KEY, trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Removes the stored device key, if any. Never throws. */
export function clearDeviceKey(): void {
  try {
    localStorage.removeItem(DEVICE_KEY_STORAGE_KEY);
  } catch {
    // Private mode / storage unavailable: nothing to clear.
  }
}
