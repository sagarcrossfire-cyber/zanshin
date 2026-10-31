// Tracks in-flight background pack seeds (src/data/bootstrap.ts) so test
// resets can wait for them instead of racing them: a seed started by one
// test's render must finish before the next test's reset deletes the DB,
// or its writes land in the next test's database. No imports: both the
// seeder and the reset helper depend on this, never on each other.
const pending = new Set<Promise<unknown>>();

export function trackSeed(run: Promise<unknown>): void {
  pending.add(run);
  void run.then(
    () => {
      pending.delete(run);
    },
    () => {
      pending.delete(run);
    },
  );
}

/** Await every in-flight seed (no-op when none). Bounded: a seed never starts one. */
export async function flushSeed(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}
