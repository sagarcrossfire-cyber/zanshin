// Error predicates safe for screens to import (no Dexie import here — the
// no-direct-storage-fetch rule forbids screens importing src/data/db.ts).

/** True when an async load raced the test teardown that closes the DB. Only
 * this error may be ignored by screen loads; everything else rethrows. */
export function isDatabaseClosedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'DatabaseClosedError';
}
