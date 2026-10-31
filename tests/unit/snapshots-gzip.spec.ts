// @vitest-environment node
// P10 — Snapshot gzip path under Node's real Blob/CompressionStream: a
// snapshot taken here IS gzip-compressed, and readSnapshot decompresses it
// via magic-byte detection. (The jsdom specs exercise the uncompressed
// fallback; jsdom's Blob lacks .stream().)
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProfile } from '../../src/data/bootstrap';
import { profileRepo, resetDbForTests, snapshotsRepo } from '../../src/data/repos';
import { readSnapshot, takeSnapshot } from '../../src/services/snapshots';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(async () => {
  await resetDbForTests();
});

describe('gzip round-trip (node environment)', () => {
  it('stores gzip bytes and reads them back', async () => {
    await profileRepo.put({ ...defaultProfile('2026-10-29T10:00:00.000Z'), displayName: 'Sagar' });
    const { id, compressed } = await takeSnapshot('manual', '2026-10-29T10:05:00.000Z');
    expect(compressed).toBe(true);
    const stored = await snapshotsRepo.get(id);
    expect(stored?.data).toBeInstanceOf(Uint8Array);
    expect(stored?.data[0]).toBe(0x1f);
    expect(stored?.data[1]).toBe(0x8b);
    const payload = await readSnapshot(id);
    expect(payload.backup.tables.profile[0]).toMatchObject({ displayName: 'Sagar' });
  });
});
