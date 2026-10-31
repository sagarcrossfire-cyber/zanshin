// Release 1.3.0 — pure helpers for web-sourced research: checking the prose
// before it is shown, building the small context the research route gets,
// and shaping Patch Watch diffs for a brief. No I/O.
import { extractFrameTokens, sanitizeMarkdown } from '../coach/checker';
import type { MatchSet, ProblemMove, ResearchCitation, ResearchKind } from '../../data/schemas';

export interface CheckedResearch {
  text: string;
  /** Frame-like numbers the text carries. They came from the web, not the
   * Codex, so the screen says so; nothing is ever written to frame data. */
  frameTokens: string[];
}

/** Frame-like numbers in prose. Unlike the coach checker, which compares
 * against a CONTEXT block, research has no context, so the button half of
 * a move input (the +2 in f,f+2, the +4 in 1+4) must not count: a frame
 * value stands alone after a space, bracket or punctuation. */
export function frameTokensInProse(text: string): string[] {
  const found: string[] = [];
  for (const token of extractFrameTokens(text)) {
    if (/^i\d/.test(token)) {
      if (!found.includes(token)) found.push(token);
      continue;
    }
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^-/, '[-−]');
    const standalone = new RegExp(`(^|[\\s(\\[:,;"'])${escaped}(?![\\w+])`, 'm');
    if (standalone.test(text) && !found.includes(token)) found.push(token);
  }
  return found;
}

/** Sanitize research Markdown and list the frame-like numbers it contains. */
export function checkResearch(text: string): CheckedResearch {
  const sanitized = sanitizeMarkdown(text).trim();
  return { frameTokens: frameTokensInProse(sanitized), text: sanitized };
}

/** `research-<kind>-<ms>[-<subject>]`: unique per note, readable in backups. */
export function researchNoteId(kind: ResearchKind, nowIso: string, subjectKey?: string): string {
  const suffix = subjectKey ? `-${subjectKey.replace(/[^A-Za-z0-9:_-]+/g, '_')}` : '';
  return `research-${kind}-${Date.parse(nowIso)}${suffix}`;
}

/** The roster character a question names, if exactly one does (longest name wins on overlap). */
export function detectCharacter(question: string, roster: Array<{ name: string }>): string | undefined {
  const lower = question.toLowerCase();
  const hits = roster
    .map((character) => character.name)
    .filter((name) => new RegExp(`(^|[^a-z])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(lower))
    .sort((a, b) => b.length - a.length);
  return hits[0];
}

/** Sagar's record against one character, as a line the research route may use. */
export function recordLine(character: string, matchSets: MatchSet[]): string | undefined {
  const sets = matchSets.filter((set) => set.opponentCharacter === character);
  if (sets.length === 0) return undefined;
  const games = sets.reduce((sum, set) => sum + set.games, 0);
  const wins = sets.reduce((sum, set) => sum + set.wins, 0);
  const beatBy = new Map<string, number>();
  for (const set of sets) for (const move of set.beatBy) beatBy.set(move, (beatBy.get(move) ?? 0) + 1);
  const top = [...beatBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([move]) => move);
  return `Sagar's record vs ${character}: ${wins}-${games - wins} over ${games} games (${sets.length} sets).${top.length > 0 ? ` Moves that beat him most: ${top.join(', ')}.` : ''}`;
}

/** Problem moves he has logged against one character, one line. */
export function problemLine(character: string, problemMoves: ProblemMove[]): string | undefined {
  const mine = problemMoves.filter((move) => move.character === character).slice(0, 6);
  if (mine.length === 0) return undefined;
  return `Logged problem moves vs ${character}: ${mine.map((move) => `${move.input} (${move.answer.kind})`).join(', ')}.`;
}

/** Context for a "Look it up" question: what the app knows that the web cannot. */
export function researchContext(input: {
  question: string;
  roster: Array<{ name: string }>;
  matchSets: MatchSet[];
  problemMoves: ProblemMove[];
  stageLabel?: string;
}): { character: string | undefined; context: string | undefined } {
  const character = detectCharacter(input.question, input.roster);
  const lines: string[] = [];
  if (input.stageLabel) lines.push(`Sagar is at curriculum stage: ${input.stageLabel}.`);
  if (character) {
    const record = recordLine(character, input.matchSets);
    if (record) lines.push(record);
    const problems = problemLine(character, input.problemMoves);
    if (problems) lines.push(problems);
  }
  return { character, context: lines.length > 0 ? lines.join('\n') : undefined };
}

export interface DiffChange {
  id: string;
  fields: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
}

/** The changed moves of a Patch Watch diff as the brief route wants them. */
export function patchChanges(
  changed: DiffChange[],
  moves: Array<{ id: string; input: string; name?: string }>,
): Array<{ moveId: string; input: string; name?: string; field: string; before: string; after: string }> {
  const byId = new Map(moves.map((move) => [move.id, move]));
  const out: Array<{ moveId: string; input: string; name?: string; field: string; before: string; after: string }> = [];
  for (const change of changed) {
    const move = byId.get(change.id);
    for (const field of change.fields) {
      out.push({
        after: String(field.newValue ?? '—'),
        before: String(field.oldValue ?? '—'),
        field: field.field,
        input: move?.input ?? change.id,
        moveId: change.id,
        ...(move?.name ? { name: move.name } : {}),
      });
    }
  }
  return out;
}

/** Hostname for a citation chip ("wavu.wiki"), or the whole URL if unparsable. */
export function citationHost(citation: Pick<ResearchCitation, 'url'>): string {
  try {
    return new URL(citation.url).hostname.replace(/^www\./, '');
  } catch {
    return citation.url;
  }
}

/** Only https links are ever rendered as links. */
export function isRenderableCitation(citation: Pick<ResearchCitation, 'url'>): boolean {
  return /^https:\/\/[^\s/]+\.[^\s/]+/.test(citation.url);
}
