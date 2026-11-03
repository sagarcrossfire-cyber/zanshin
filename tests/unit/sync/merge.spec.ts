// M3 — merge acceptance tests: LWW, tombstone beats older put, newer put after tombstone wins,
// idempotent replay.
import { describe, expect, it } from 'vitest';
import { formatHlc } from '../../../src/domain/sync/hlc';
import { mergeChange, type LocalRecordMeta, type SyncChange } from '../../../src/domain/sync/merge';

const hlc = (wallMs: number, counter = 0, deviceId = 'device-a') => formatHlc(wallMs, counter, deviceId);

describe('mergeChange', () => {
  it('applies when there is no local HLC yet', () => {
    const change: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(1000), op: 'put', value: { a: 1 } };
    const decision = mergeChange(undefined, change);
    expect(decision).toEqual({ action: 'apply', nextMeta: { hlc: hlc(1000), tombstone: false } });
  });

  it('applies a newer put over an older local record (LWW)', () => {
    const local: LocalRecordMeta = { hlc: hlc(1000), tombstone: false };
    const change: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(2000), op: 'put', value: { a: 2 } };
    const decision = mergeChange(local, change);
    expect(decision).toEqual({ action: 'apply', nextMeta: { hlc: hlc(2000), tombstone: false } });
  });

  it('skips an older put against a newer local record', () => {
    const local: LocalRecordMeta = { hlc: hlc(2000), tombstone: false };
    const change: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(1000), op: 'put', value: { a: 1 } };
    expect(mergeChange(local, change)).toEqual({ action: 'skip' });
  });

  it('a tombstone beats an older put for the same id', () => {
    const local: LocalRecordMeta = { hlc: hlc(2000), tombstone: true };
    const olderPut: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(1000), op: 'put', value: { a: 1 } };
    expect(mergeChange(local, olderPut)).toEqual({ action: 'skip' });
  });

  it('a newer put after a tombstone wins (record resurrected by a later real write)', () => {
    const local: LocalRecordMeta = { hlc: hlc(1000), tombstone: true };
    const newerPut: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(2000), op: 'put', value: { a: 2 } };
    const decision = mergeChange(local, newerPut);
    expect(decision).toEqual({ action: 'apply', nextMeta: { hlc: hlc(2000), tombstone: false } });
  });

  it('a delete becomes a tombstone that is kept in meta', () => {
    const del: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(1000), op: 'delete' };
    const decision = mergeChange(undefined, del);
    expect(decision).toEqual({ action: 'apply', nextMeta: { hlc: hlc(1000), tombstone: true } });
  });

  it('applying the same change twice is a no-op the second time (idempotent replay)', () => {
    const change: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(1000), op: 'put', value: { a: 1 } };
    const first = mergeChange(undefined, change);
    expect(first.action).toBe('apply');
    const nextMeta = first.action === 'apply' ? first.nextMeta : undefined;
    const second = mergeChange(nextMeta, change);
    expect(second).toEqual({ action: 'skip' });
  });

  it('replaying the exact same delete twice is also a no-op the second time', () => {
    const del: SyncChange = { table: 'cards', id: 'c1', hlc: hlc(1000), op: 'delete' };
    const first = mergeChange(undefined, del);
    const nextMeta = first.action === 'apply' ? first.nextMeta : undefined;
    const second = mergeChange(nextMeta, del);
    expect(second).toEqual({ action: 'skip' });
  });
});
