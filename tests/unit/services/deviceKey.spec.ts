// 2.0 M2 — deviceKey: localStorage-only storage (never IndexedDB), 16-256
// char validation after trimming, and storage-failure tolerance (private
// mode throws on every localStorage call).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDeviceKey, DEVICE_KEY_MAX_LENGTH, DEVICE_KEY_MIN_LENGTH, getDeviceKey, setDeviceKey } from '../../../src/services/deviceKey';

const VALID_KEY = 'a'.repeat(32);

describe('deviceKey', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('getDeviceKey returns null when unset', () => {
    expect(getDeviceKey()).toBeNull();
  });

  it('setDeviceKey stores a trimmed valid key and getDeviceKey reads it back', () => {
    expect(setDeviceKey(`  ${VALID_KEY}  `)).toBe(true);
    expect(getDeviceKey()).toBe(VALID_KEY);
    expect(localStorage.getItem('zanshin.deviceKey')).toBe(VALID_KEY);
  });

  it('rejects a key shorter than the minimum, after trimming', () => {
    expect(setDeviceKey('a'.repeat(DEVICE_KEY_MIN_LENGTH - 1))).toBe(false);
    expect(getDeviceKey()).toBeNull();
  });

  it('rejects a key longer than the maximum', () => {
    expect(setDeviceKey('a'.repeat(DEVICE_KEY_MAX_LENGTH + 1))).toBe(false);
    expect(getDeviceKey()).toBeNull();
  });

  it('accepts the exact boundary lengths', () => {
    expect(setDeviceKey('a'.repeat(DEVICE_KEY_MIN_LENGTH))).toBe(true);
    expect(setDeviceKey('b'.repeat(DEVICE_KEY_MAX_LENGTH))).toBe(true);
  });

  it('rejects whitespace-only / empty input', () => {
    expect(setDeviceKey('   ')).toBe(false);
    expect(setDeviceKey('')).toBe(false);
  });

  it('clearDeviceKey removes a stored key', () => {
    setDeviceKey(VALID_KEY);
    clearDeviceKey();
    expect(getDeviceKey()).toBeNull();
  });

  it('a stored value outside the valid length (e.g. corrupted) reads back as null', () => {
    localStorage.setItem('zanshin.deviceKey', 'short');
    expect(getDeviceKey()).toBeNull();
  });

  describe('storage failures (private mode)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('getDeviceKey tolerates a throwing localStorage.getItem', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      expect(getDeviceKey()).toBeNull();
    });

    it('setDeviceKey tolerates a throwing localStorage.setItem', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      expect(setDeviceKey(VALID_KEY)).toBe(false);
    });

    it('clearDeviceKey tolerates a throwing localStorage.removeItem', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      expect(() => clearDeviceKey()).not.toThrow();
    });
  });
});
