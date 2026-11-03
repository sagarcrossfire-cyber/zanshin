// 2.0 M2 — the device-key lock every function adopts before the site goes
// public (SSO Option B, docs/REFERENCE.md §8 decisions). No hash configured
// fails closed (503); a missing or wrong key is 401; any of several
// configured hashes (one per paired device) may match. The raw key is never
// echoed back or thrown into an error message.
import { describe, expect, it } from 'vitest';
import {
  DEVICE_KEY_ENV, DEVICE_KEY_HEADER, parseDeviceKeyHashes, sha256Hex, verifyDeviceKey,
} from '../../../src/server/deviceKey';

const KEY_A = 'pc-device-key-0123456789abcdef';
const KEY_B = 'phone-device-key-0123456789abcdef';

function request(key?: string): Request {
  const headers: Record<string, string> = key === undefined ? {} : { [DEVICE_KEY_HEADER]: key };
  return new Request('https://zanshin.test/api/ranked?id=abc', { headers });
}

describe('deviceKey', () => {
  it('exports the header name and env var name used by every locked function', () => {
    expect(DEVICE_KEY_HEADER).toBe('x-zanshin-device');
    expect(DEVICE_KEY_ENV).toBe('ZANSHIN_DEVICE_KEY_SHA256');
  });

  it('parseDeviceKeyHashes keeps only well-formed 64-char hex hashes, lowercased and trimmed', () => {
    expect(parseDeviceKeyHashes(undefined)).toEqual([]);
    expect(parseDeviceKeyHashes('')).toEqual([]);
    expect(parseDeviceKeyHashes('not-a-hash, , short')).toEqual([]);
    const hashA = 'A'.repeat(64);
    const hashB = 'b'.repeat(64);
    expect(parseDeviceKeyHashes(` ${hashA} , ${hashB} `)).toEqual([hashA.toLowerCase(), hashB]);
  });

  it('503 device-key-unset when the env var is not configured (fails closed)', async () => {
    const result = await verifyDeviceKey(request(KEY_A), undefined);
    expect(result).toMatchObject({ code: 'device-key-unset', ok: false, status: 503 });
    const blank = await verifyDeviceKey(request(KEY_A), '   ');
    expect(blank).toMatchObject({ code: 'device-key-unset', ok: false, status: 503 });
  });

  it('401 device-key when the header is missing, empty, too short, or wrong', async () => {
    const hashA = await sha256Hex(KEY_A);
    expect(await verifyDeviceKey(request(undefined), hashA)).toMatchObject({ code: 'device-key', status: 401 });
    expect(await verifyDeviceKey(request(''), hashA)).toMatchObject({ code: 'device-key', status: 401 });
    expect(await verifyDeviceKey(request('short'), hashA)).toMatchObject({ code: 'device-key', status: 401 });
    expect(await verifyDeviceKey(request(KEY_B), hashA)).toMatchObject({ code: 'device-key', status: 401 });
  });

  it('ok when the key hashes to one of several comma-separated hashes', async () => {
    const hashA = await sha256Hex(KEY_A);
    const hashB = await sha256Hex(KEY_B);
    const configured = `${hashA},${hashB}`;
    expect(await verifyDeviceKey(request(KEY_A), configured)).toEqual({ ok: true });
    expect(await verifyDeviceKey(request(KEY_B), configured)).toEqual({ ok: true });
    expect(await verifyDeviceKey(request(KEY_B.toUpperCase()), configured)).toMatchObject({ ok: false });
  });

  it('never echoes the submitted key back in a result message', async () => {
    const result = await verifyDeviceKey(request('wrong-key-0123456789abcdef'), await sha256Hex(KEY_A));
    expect(JSON.stringify(result)).not.toContain('wrong-key-0123456789abcdef');
  });
});
