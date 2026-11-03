// 2.0 M6: which Yoshimitsu move Today plays on a loop. Pure.
//
// First choice: a move today's plan trains (the drills' Codex references, in
// plan order) that has a clip. Otherwise a daily rotation through every move
// with a clip, stable for the whole day and different the next.

/** A small, stable hash of the day (FNV-1a over the ISO date). */
export function dayHash(date: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i += 1) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function pickMoveOfTheDay(
  planMoveIds: readonly string[],
  pool: readonly string[],
  date: string,
  hasClip: (moveId: string) => boolean,
): string | null {
  for (const id of planMoveIds) if (hasClip(id)) return id;
  const withClips = pool.filter(hasClip);
  if (withClips.length === 0) return null;
  return withClips[dayHash(date) % withClips.length] ?? null;
}
