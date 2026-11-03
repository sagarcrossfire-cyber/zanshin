// M3 — crypto acceptance tests: pairing code round-trip/checksum/tolerant parsing, deriveKeys
// determinism and per-info distinctness, encrypt/decrypt round-trip, tamper, wrong key, fresh IVs.
import { describe, expect, it } from 'vitest';
import {
  PairingCodeError,
  SyncDecryptError,
  authVerifier,
  decodePairingCode,
  decryptBatch,
  deriveKeys,
  encodePairingCode,
  encryptBatch,
  generatePairingSecret,
} from '../../../src/domain/sync/crypto';

function fixedSecret(fill = 0x11): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = (fill + i) % 256;
  return bytes;
}

describe('crypto: pairing code', () => {
  it('round-trips a 32-byte secret through encode/decode', () => {
    const secret = fixedSecret();
    const code = encodePairingCode(secret);
    expect(decodePairingCode(code)).toEqual(secret);
  });

  it('produces the documented shape: 13 groups of 4 plus a 2-char checksum group', () => {
    const code = encodePairingCode(fixedSecret());
    const groups = code.split('-');
    expect(groups).toHaveLength(14);
    for (const g of groups.slice(0, 13)) expect(g).toHaveLength(4);
    expect(groups[13]).toHaveLength(2);
    expect(code.replace(/-/g, '')).toHaveLength(54);
  });

  it('is tolerant of lower case, extra spaces and different dash placement', () => {
    const code = encodePairingCode(fixedSecret());
    const messy = code.toLowerCase().replace(/-/g, ' - ').trim();
    expect(decodePairingCode(messy)).toEqual(fixedSecret());
  });

  it('rejects a bad checksum (single flipped character)', () => {
    const code = encodePairingCode(fixedSecret());
    const flipped = code[0] === '0' ? `1${code.slice(1)}` : `0${code.slice(1)}`;
    expect(() => decodePairingCode(flipped)).toThrow(PairingCodeError);
  });

  it('rejects a code of the wrong length', () => {
    expect(() => decodePairingCode('ABCD-EFGH')).toThrow(PairingCodeError);
  });

  it('rejects a secret of the wrong length on encode', () => {
    expect(() => encodePairingCode(new Uint8Array(16))).toThrow(PairingCodeError);
  });

  it('generatePairingSecret returns 32 random bytes that differ between calls', () => {
    const a = generatePairingSecret();
    const b = generatePairingSecret();
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
  });
});

describe('crypto: deriveKeys', () => {
  it('is deterministic for a fixed secret', async () => {
    const secret = fixedSecret();
    const keysA = await deriveKeys(secret);
    const keysB = await deriveKeys(secret);
    expect(keysA.authKey).toBe(keysB.authKey);
    expect(keysA.deviceKey).toBe(keysB.deviceKey);
  });

  it('derives different auth and device keys from each other', async () => {
    const keys = await deriveKeys(fixedSecret());
    expect(keys.authKey).not.toBe(keys.deviceKey);
  });

  it('derives different keys for different secrets', async () => {
    const keysA = await deriveKeys(fixedSecret(0x11));
    const keysB = await deriveKeys(fixedSecret(0x22));
    expect(keysA.authKey).not.toBe(keysB.authKey);
    expect(keysA.deviceKey).not.toBe(keysB.deviceKey);
  });

  it('produces a non-extractable AES-GCM encKey', async () => {
    const { encKey } = await deriveKeys(fixedSecret());
    expect(encKey.extractable).toBe(false);
    expect(encKey.algorithm.name).toBe('AES-GCM');
    expect(encKey.usages.sort()).toEqual(['decrypt', 'encrypt']);
  });
});

describe('crypto: encryptBatch / decryptBatch', () => {
  it('round-trips a JSON payload', async () => {
    const { encKey } = await deriveKeys(fixedSecret());
    const json = JSON.stringify({ hello: 'world', n: 42 });
    const blob = await encryptBatch(encKey, json);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(await decryptBatch(encKey, blob)).toBe(json);
  });

  it('uses a fresh IV every call, even for identical plaintext', async () => {
    const { encKey } = await deriveKeys(fixedSecret());
    const json = JSON.stringify({ same: true });
    const a = await encryptBatch(encKey, json);
    const b = await encryptBatch(encKey, json);
    const ivOf = (blob: string) => blob.split('.')[1];
    expect(ivOf(a)).not.toBe(ivOf(b));
    expect(a).not.toBe(b);
  });

  it('throws SyncDecryptError on tampered ciphertext', async () => {
    const { encKey } = await deriveKeys(fixedSecret());
    const blob = await encryptBatch(encKey, JSON.stringify({ a: 1 }));
    const parts = blob.split('.');
    const tamperedTail = parts[2]!.slice(0, -2) + (parts[2]!.slice(-2) === 'AA' ? 'BB' : 'AA');
    const tampered = `${parts[0]}.${parts[1]}.${tamperedTail}`;
    await expect(decryptBatch(encKey, tampered)).rejects.toThrow(SyncDecryptError);
  });

  it('throws SyncDecryptError when decrypting with the wrong key', async () => {
    const { encKey: keyA } = await deriveKeys(fixedSecret(0x11));
    const { encKey: keyB } = await deriveKeys(fixedSecret(0x22));
    const blob = await encryptBatch(keyA, JSON.stringify({ a: 1 }));
    await expect(decryptBatch(keyB, blob)).rejects.toThrow(SyncDecryptError);
  });

  it('throws SyncDecryptError on a malformed blob and never returns partial data', async () => {
    const { encKey } = await deriveKeys(fixedSecret());
    await expect(decryptBatch(encKey, 'not-a-real-blob')).rejects.toThrow(SyncDecryptError);
    await expect(decryptBatch(encKey, 'v2.aaaa.bbbb')).rejects.toThrow(SyncDecryptError);
    await expect(decryptBatch(encKey, 'v1.not-base64url!!!.bbbb')).rejects.toThrow(SyncDecryptError);
  });
});

describe('crypto: authVerifier', () => {
  it('is a deterministic SHA-256 hex digest of the auth key', async () => {
    const { authKey } = await deriveKeys(fixedSecret());
    const a = await authVerifier(authKey);
    const b = await authVerifier(authKey);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different auth keys', async () => {
    const { authKey: keyA } = await deriveKeys(fixedSecret(0x11));
    const { authKey: keyB } = await deriveKeys(fixedSecret(0x22));
    expect(await authVerifier(keyA)).not.toBe(await authVerifier(keyB));
  });
});
