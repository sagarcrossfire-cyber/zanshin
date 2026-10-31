// Amendment 01B — pure helpers for media subjects. A subject key names what
// an imported image or clip belongs to: character:<roster name>,
// move:<Wavu Move.id>, rank:<rank name>, or app:<slot>.
import type { MediaKind } from '../../data/schemas';

export const APP_SLOTS = ['logo', 'key-art'] as const;

export function characterSubject(name: string): string {
  return `character:${name}`;
}

export function moveSubject(moveId: string): string {
  return `move:${moveId}`;
}

export function rankSubject(rank: string): string {
  return `rank:${rank}`;
}

/** The kinds that may attach to each subject type. */
export function kindsForSubject(subjectKey: string): MediaKind[] {
  if (subjectKey.startsWith('character:')) return ['character-icon', 'character-portrait'];
  if (subjectKey.startsWith('move:')) return ['move-clip'];
  if (subjectKey.startsWith('rank:')) return ['rank-badge'];
  if (subjectKey === 'app:logo') return ['game-logo'];
  if (subjectKey === 'app:key-art') return ['key-art'];
  return [];
}

/** True when the kind fits the subject type (an icon for a character, a clip for a move…). */
export function kindFitsSubject(kind: MediaKind, subjectKey: string): boolean {
  return kindsForSubject(subjectKey).includes(kind);
}

/** True when the MIME type fits the kind: clips are video, everything else an image. */
export function mimeFitsKind(kind: MediaKind, mime: string): boolean {
  const type = mime.toLowerCase();
  if (kind === 'move-clip') return type === 'video/mp4' || type === 'video/webm' || type === 'video/quicktime';
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type);
}

const EXTENSION_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/** The file's MIME type, from the browser when it knows, else from the extension. */
export function guessMime(fileName: string, reported?: string): string {
  if (reported && reported !== '' && reported !== 'application/octet-stream') return reported.toLowerCase();
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

export function extensionForMime(mime: string): string {
  const found = Object.entries(EXTENSION_MIME).find(([, value]) => value === mime.toLowerCase());
  return found ? found[0] : 'bin';
}

/**
 * The roster character a Wavu move id belongs to. Ids are "<Name>-<input>",
 * and names can contain hyphens (Jack-8), so the longest matching roster
 * name wins.
 */
export function characterOfMoveId(moveId: string, roster: readonly string[]): string | null {
  let best: string | null = null;
  for (const name of roster) {
    if (moveId.startsWith(`${name}-`) && (best === null || name.length > best.length)) best = name;
  }
  return best;
}

/** The Wavu id of a character's move, from the character and its input. */
export function wavuMoveId(character: string, input: string): string {
  return `${character}-${input}`;
}

/** A short human label for a subject key. Pass the roster so a hyphenated
 * name (Jack-8) splits from its move input correctly. */
export function subjectLabel(subjectKey: string, roster?: readonly string[]): string {
  const [type, ...rest] = subjectKey.split(':');
  const value = rest.join(':');
  if (type === 'move') {
    const character = roster ? characterOfMoveId(value, roster) : null;
    return character ? `${character} ${value.slice(character.length + 1)}` : value.replace(/-/, ' ');
  }
  if (type === 'app') return value === 'logo' ? 'App logo' : 'Key art';
  return value;
}

export interface UnmatchedCheck {
  roster: readonly string[];
  /** Move ids from the bundled Yoshimitsu pack. */
  yoshimitsuMoveIds: ReadonlySet<string>;
  /** Rank names the app knows. */
  ranks: readonly string[];
}

/**
 * True when a subject points at something the app knows: a roster
 * character, a Yoshimitsu move in the pack, any roster character's move
 * (opponent packs load on demand, so their ids cannot all be known), a
 * known rank, or an app slot.
 */
export function isKnownSubject(subjectKey: string, check: UnmatchedCheck): boolean {
  const [type, ...rest] = subjectKey.split(':');
  const value = rest.join(':');
  if (type === 'character') return check.roster.includes(value);
  if (type === 'rank') return check.ranks.includes(value);
  if (type === 'app') return (APP_SLOTS as readonly string[]).includes(value);
  if (type === 'move') {
    const character = characterOfMoveId(value, check.roster);
    if (character === null) return false;
    if (character === 'Yoshimitsu') return check.yoshimitsuMoveIds.has(value);
    return value.length > character.length + 1;
  }
  return false;
}
