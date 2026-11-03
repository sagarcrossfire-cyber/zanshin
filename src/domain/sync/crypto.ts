// M3 — sync crypto. WebCrypto only (crypto.subtle / crypto.getRandomValues), so this runs
// unmodified in browsers, Node 22 and Vitest/jsdom. Pure: no Dexie, no fetch, no UI, and this
// module never logs or persists a secret, key or plaintext payload — callers must not either.

const SYNC_AAD = 'zanshin-sync-v1';
const HKDF_SALT = 'zanshin-sync-v1';
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PAIRING_SECRET_BYTES = 32;
const PAIRING_DATA_SYMBOLS = 52; // ceil(32 * 8 / 5)
const PAIRING_CHECKSUM_SYMBOLS = 2; // 10 bits, 0..1023

function subtle(): SubtleCrypto {
  return crypto.subtle;
}

/** Thrown for a malformed, mistyped or checksum-failing pairing code. */
export class PairingCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingCodeError';
  }
}

/** Thrown when a batch fails to decrypt: tampered ciphertext, wrong key, or a malformed blob. */
export class SyncDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncDecryptError';
  }
}

// ---------- base32 (Crockford) ----------

function encodeBase32(bytes: Uint8Array): string {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  const totalBits = bytes.length * 8;
  const symbolCount = Math.ceil(totalBits / 5);
  const padBits = symbolCount * 5 - totalBits;
  value <<= BigInt(padBits);
  let out = '';
  for (let i = symbolCount - 1; i >= 0; i -= 1) {
    const idx = Number((value >> BigInt(i * 5)) & 0x1fn);
    out += CROCKFORD_ALPHABET[idx];
  }
  return out;
}

function decodeBase32(text: string, expectedByteLength: number): Uint8Array {
  let value = 0n;
  for (const ch of text) {
    const idx = CROCKFORD_ALPHABET.indexOf(ch);
    if (idx < 0) throw new PairingCodeError(`invalid pairing code character: ${ch}`);
    value = (value << 5n) | BigInt(idx);
  }
  const totalBits = text.length * 5;
  const expectedBits = expectedByteLength * 8;
  if (totalBits < expectedBits) throw new PairingCodeError('pairing code is too short');
  value >>= BigInt(totalBits - expectedBits);
  const bytes = new Uint8Array(expectedByteLength);
  for (let i = expectedByteLength - 1; i >= 0; i -= 1) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

/** A simple positional checksum (not cryptographic) that catches typos and transpositions. */
function checksumValue(bytes: Uint8Array): number {
  let acc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    acc = (acc + bytes[i]! * (i + 1)) % 1024;
  }
  return acc;
}

function encodeChecksum(bytes: Uint8Array): string {
  const v = checksumValue(bytes);
  const high = CROCKFORD_ALPHABET[(v >> 5) & 0x1f] ?? '0';
  const low = CROCKFORD_ALPHABET[v & 0x1f] ?? '0';
  return high + low;
}

function groupInFours(data: string): string {
  const groups: string[] = [];
  for (let i = 0; i < data.length; i += 4) groups.push(data.slice(i, i + 4));
  return groups.join('-');
}

/** Encode a 32-byte pairing secret as a 13x4-group Crockford base32 code plus a 2-char checksum. */
export function encodePairingCode(secretBytes: Uint8Array): string {
  if (secretBytes.length !== PAIRING_SECRET_BYTES) {
    throw new PairingCodeError(`pairing secret must be ${PAIRING_SECRET_BYTES} bytes`);
  }
  const data = encodeBase32(secretBytes);
  const checksum = encodeChecksum(secretBytes);
  return `${groupInFours(data)}-${checksum}`;
}

function normalizePairingInput(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Decode a pairing code (tolerant of case, spaces and dashes). Throws PairingCodeError on a bad checksum or shape. */
export function decodePairingCode(text: string): Uint8Array {
  const normalized = normalizePairingInput(text);
  const expectedLength = PAIRING_DATA_SYMBOLS + PAIRING_CHECKSUM_SYMBOLS;
  if (normalized.length !== expectedLength) {
    throw new PairingCodeError(`pairing code must decode to ${expectedLength} characters, got ${normalized.length}`);
  }
  const data = normalized.slice(0, PAIRING_DATA_SYMBOLS);
  const checksum = normalized.slice(PAIRING_DATA_SYMBOLS);
  const secretBytes = decodeBase32(data, PAIRING_SECRET_BYTES);
  if (encodeChecksum(secretBytes) !== checksum) {
    throw new PairingCodeError('pairing code checksum mismatch');
  }
  return secretBytes;
}

// ---------- base64url ----------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padLength = (4 - (text.length % 4)) % 4;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------- key derivation ----------

export interface SyncKeys {
  /** Non-extractable AES-GCM 256 key for encryptBatch/decryptBatch. */
  encKey: CryptoKey;
  /** base64url, 32 raw bytes: proves pairing to the sync endpoint (server stores authVerifier of this). */
  authKey: string;
  /** base64url, 32 raw bytes: the device key for /api/ranked and future server functions. */
  deviceKey: string;
}

/** Derive the encryption, auth and device keys from an already-imported, non-extractable HKDF
 * base key (e.g. the one stored in `syncMeta` 'pairing' after pairing — see
 * src/data/repos/syncState.ts). The sole HKDF derivation path: `deriveKeys` below imports raw
 * bytes into exactly this kind of base key and then calls this function, so there is never a
 * second copy of the salt/info/hash parameters to drift out of sync. */
export async function deriveKeysFromBaseKey(baseKey: CryptoKey): Promise<SyncKeys> {
  const salt = new TextEncoder().encode(HKDF_SALT);
  const encKey = await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('enc') },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const authBits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('auth') },
    baseKey,
    256,
  );
  const deviceBits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('device') },
    baseKey,
    256,
  );
  return { encKey, authKey: toBase64Url(new Uint8Array(authBits)), deviceKey: toBase64Url(new Uint8Array(deviceBits)) };
}

/** Derive the encryption, auth and device keys from one raw pairing secret (HKDF-SHA-256). */
export async function deriveKeys(secretBytes: Uint8Array): Promise<SyncKeys> {
  const keyMaterial = await subtle().importKey(
    'raw',
    secretBytes as BufferSource,
    'HKDF',
    false,
    ['deriveKey', 'deriveBits'],
  );
  return deriveKeysFromBaseKey(keyMaterial);
}

// ---------- batch encryption ----------

const IV_BYTES = 12;

/** Encrypt a JSON batch with AES-GCM, a fresh random IV, and a fixed additional-data tag. */
export async function encryptBatch(encKey: CryptoKey, json: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(SYNC_AAD) },
    encKey,
    new TextEncoder().encode(json) as BufferSource,
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Decrypt a batch produced by encryptBatch. Throws SyncDecryptError on tamper, wrong key, or a malformed blob — never returns partial data. */
export async function decryptBatch(encKey: CryptoKey, blob: string): Promise<string> {
  const parts = blob.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new SyncDecryptError('malformed sync batch blob');
  }
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = fromBase64Url(parts[1]!);
    ciphertext = fromBase64Url(parts[2]!);
  } catch {
    throw new SyncDecryptError('malformed sync batch blob');
  }
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(SYNC_AAD) },
      encKey,
      ciphertext as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SyncDecryptError('sync batch failed to decrypt (tampered data or wrong key)');
  }
}

// ---------- auth verifier ----------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex digest of the auth key — the only thing the server ever stores for pairing. */
export async function authVerifier(authKey: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(authKey));
  return toHex(new Uint8Array(digest));
}

/** Generate a fresh 32-byte pairing secret. */
export function generatePairingSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(PAIRING_SECRET_BYTES));
}
