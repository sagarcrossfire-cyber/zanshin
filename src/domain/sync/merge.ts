// M3 — merge decision for an incoming sync change. Pure, no Dexie, no fetch, no UI.
// Repositories (a later card) are the ones that actually read/write Dexie; this module only
// decides apply-vs-skip given the local HLC metadata for a record.

import { compare } from './hlc';

export type SyncOp = 'put' | 'delete';

/** One change from the device log, as the wire/engine shape (not a Dexie row). */
export interface SyncChange<T = unknown> {
  table: string;
  id: string;
  hlc: string;
  op: SyncOp;
  value?: T;
}

/**
 * What `syncMeta` (or an equivalent table) holds per `table:id`. A tombstone is kept forever so an
 * older, already-superseded `put` can never resurrect a deleted record.
 */
export interface LocalRecordMeta {
  hlc: string;
  tombstone: boolean;
}

export type MergeDecision =
  | { action: 'apply'; nextMeta: LocalRecordMeta }
  | { action: 'skip' };

/**
 * Decide whether to apply an incoming change against the local HLC metadata for that record.
 * Apply when there is no local HLC yet, or the change's HLC is strictly newer than the local one
 * (by causal/lexical order, see hlc.ts). Equal or older HLCs are skipped, which makes replaying
 * the same change idempotent and makes a tombstone outrank any older `put` for the same id.
 */
export function mergeChange(localMeta: LocalRecordMeta | undefined, change: SyncChange): MergeDecision {
  if (localMeta && compare(change.hlc, localMeta.hlc) <= 0) {
    return { action: 'skip' };
  }
  return {
    action: 'apply',
    nextMeta: { hlc: change.hlc, tombstone: change.op === 'delete' },
  };
}
