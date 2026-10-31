// Release 1.3.0 — research: "Look it up" answers, matchup primers and patch
// briefs from the site's intel function, checked and kept as research notes.
// Everything here is prose with citations and the 'web' badge. Nothing it
// returns is ever written into a move, a punisher or any verified field.
import { loadMovesYoshimitsu, loadRoster } from '../data/packs';
import { researchRepo } from '../data/repos/research';
import { matchSetsRepo } from '../data/repos/matchSets';
import { problemMovesRepo } from '../data/repos/problemMoves';
import type { ResearchNote } from '../data/schemas';
import {
  checkResearch,
  patchChanges,
  researchContext,
  researchNoteId,
  type DiffChange,
} from '../domain/intel/research';
import {
  matchupPrimer,
  patchBrief,
  research,
  type IntelClientOptions,
  type IntelModel,
  type IntelUsage,
} from './intel';

export interface ResearchDeps {
  nowIso?: string;
  client?: IntelClientOptions;
}

function now(deps: ResearchDeps): string {
  return deps.nowIso ?? new Date().toISOString();
}

export interface LookUpResult {
  /** An unsaved note: the screen shows it and may keep it. */
  note: ResearchNote;
  frameTokens: string[];
  usage: IntelUsage;
  character: string | undefined;
}

/** Ask the intel function a Tekken question with the app's own context attached. */
export async function lookUp(question: string, options: { model?: IntelModel; recency?: 'day' | 'week' | 'month' | 'year' } = {}, deps: ResearchDeps = {}): Promise<LookUpResult> {
  const trimmed = question.trim();
  if (trimmed === '') throw new Error('Ask a question first.');
  const [matchSets, problemMoves] = await Promise.all([matchSetsRepo.all(), problemMovesRepo.all()]);
  const { character, context } = researchContext({ matchSets, problemMoves, question: trimmed, roster: loadRoster() });
  const answer = await research({ context, model: options.model, question: trimmed, recency: options.recency }, deps.client);
  const checked = checkResearch(answer.text);
  const createdAt = now(deps);
  const subjectKey = character ? `character:${character}` : undefined;
  const note: ResearchNote = {
    citations: answer.citations,
    costUsd: answer.usage.costUsd,
    createdAt,
    id: researchNoteId('answer', createdAt, subjectKey),
    kind: 'answer',
    question: trimmed,
    text: checked.text === '' ? 'No answer came back.' : checked.text,
    ...(subjectKey ? { subjectKey } : {}),
    model: answer.model,
  };
  return { character, frameTokens: checked.frameTokens, note, usage: answer.usage };
}

export async function saveNote(note: ResearchNote): Promise<ResearchNote> {
  return researchRepo.put(note);
}

export async function deleteNote(id: string): Promise<void> {
  await researchRepo.remove(id);
}

export async function listNotes(): Promise<ResearchNote[]> {
  return researchRepo.all();
}

export interface PrimerView {
  note: ResearchNote;
  frameTokens: string[];
  /** True when this came from the device, not the site. */
  fromDevice: boolean;
  /** True when the site served an expired copy because regeneration failed. */
  stale: boolean;
  usage?: IntelUsage;
}

/** The newest primer kept on this device for one character, if any. */
export async function storedPrimer(character: string): Promise<PrimerView | null> {
  const note = await researchRepo.latest('primer', `character:${character}`);
  if (note === undefined) return null;
  return { frameTokens: checkResearch(note.text).frameTokens, fromDevice: true, note, stale: false };
}

/** Fetch (or refresh) the matchup primer and keep it on the device. The
 * site caches primers for 30 days, so a repeat fetch is usually free. */
export async function fetchPrimer(character: string, refresh = false, deps: ResearchDeps = {}): Promise<PrimerView> {
  const result = await matchupPrimer(character, refresh, deps.client);
  const checked = checkResearch(result.text);
  const subjectKey = `character:${character}`;
  const previous = await researchRepo.latest('primer', subjectKey);
  const note: ResearchNote = {
    citations: result.citations,
    costUsd: result.usage.costUsd,
    createdAt: result.generatedAt,
    id: previous?.id ?? researchNoteId('primer', result.generatedAt, subjectKey),
    kind: 'primer',
    model: result.model,
    question: `Yoshimitsu vs ${character}`,
    subjectKey,
    text: checked.text === '' ? 'No primer came back.' : checked.text,
  };
  await researchRepo.put(note);
  return { frameTokens: checked.frameTokens, fromDevice: false, note, stale: result.stale, usage: result.usage };
}

export interface BriefView {
  note: ResearchNote;
  frameTokens: string[];
  fromDevice: boolean;
  usage?: IntelUsage;
}

export async function storedBrief(revision: string): Promise<BriefView | null> {
  const note = await researchRepo.latest('patch', `patch:${revision}`);
  if (note === undefined) return null;
  return { frameTokens: checkResearch(note.text).frameTokens, fromDevice: true, note };
}

/** Explain the last applied Wavu diff: one bullet per changed move, cited. */
export async function fetchBrief(
  diff: { patch: string; revision: string; changed: DiffChange[] },
  refresh = false,
  deps: ResearchDeps = {},
): Promise<BriefView> {
  const changes = patchChanges(diff.changed, loadMovesYoshimitsu());
  if (changes.length === 0) throw new Error('This update changed no Yoshimitsu move data, so there is nothing to explain.');
  const result = await patchBrief({ changes, patch: diff.patch, refresh, revision: diff.revision }, deps.client);
  const checked = checkResearch(result.text);
  const subjectKey = `patch:${diff.revision}`;
  const previous = await researchRepo.latest('patch', subjectKey);
  const note: ResearchNote = {
    citations: result.citations,
    costUsd: result.usage.costUsd,
    createdAt: result.generatedAt,
    id: previous?.id ?? researchNoteId('patch', result.generatedAt, subjectKey),
    kind: 'patch',
    model: result.model,
    question: `Patch ${diff.patch} · Wavu revision ${diff.revision}`,
    revision: diff.revision,
    subjectKey,
    text: checked.text === '' ? 'No brief came back.' : checked.text,
  };
  await researchRepo.put(note);
  return { frameTokens: checked.frameTokens, fromDevice: false, note, usage: result.usage };
}
