// 2.0 command palette index (docs/v2/research/design.md §B.2). Built from the
// hub map and the bundled packs — no IndexedDB, no network — and loaded only
// when the palette first opens, so the shell budget holds. `searchPalette`
// is pure and unit-tested.
import { HUBS } from './hubs';
import { loadCombos, loadCurriculum, loadMovesYoshimitsu, loadRoster, loadStances } from '../data/packs';

export type PaletteGroup = 'Actions' | 'Go to' | 'Moves' | 'Stances' | 'Combos' | 'Characters' | 'Lessons' | 'Ask';

export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Breadcrumb or detail shown after the label. */
  hint: string;
  to: string;
  /** Extra words it should match (notation, abbreviations). */
  keywords: string[];
}

/** Lowercase, unify minus signs, drop spaces and separators so "1+4", "1 + 4"
 * and "1,4" style queries meet the notation in the packs. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[−–]/g, '-').replace(/[\s_]+/g, '');
}

/** QA M2: a second, looser normal form that also drops the "+" and ","
 * notation separators, so "b1+2"/"b+1+2" and "ff3"/"f,F+3" are recognised as
 * the same move input regardless of which separator style the query used. */
function denotate(text: string): string {
  return normalize(text).replace(/[+,]/g, '');
}

/** Extra keywords that fix specific QA M2 mis-rankings, keyed by section id. */
const SECTION_KEYWORDS: Record<string, string[]> = {
  matches: ['log', 'match log', 'matches', 'history'],
};

const ACTIONS: Array<Omit<PaletteEntry, 'group' | 'keywords'> & { keywords?: string[] }> = [
  { id: 'a-session', label: "Start today's session", hint: 'Train › Lab', to: '/lab', keywords: ['practice', 'drill', 'start'] },
  { id: 'a-log', label: 'Log a match set', hint: 'You › Matches', to: '/log/new', keywords: ['ranked', 'record', 'add'] },
  { id: 'a-import', label: 'Import matches', hint: 'You › Matches', to: '/log/import', keywords: ['csv', 'ranked'] },
  { id: 'a-cards', label: 'Review due flashcards', hint: 'Train › Flashcards', to: '/cards/review', keywords: ['srs', 'cards', 'review'] },
  { id: 'a-ask', label: 'Ask the coach', hint: 'Coach › Ask', to: '/coach/ask', keywords: ['ai', 'question', 'help'] },
  { id: 'a-review', label: 'Weekly review', hint: 'Coach', to: '/coach/review', keywords: ['week', 'summary'] },
  { id: 'a-lookup', label: 'Look it up on the web', hint: 'Coach › Look it up', to: '/coach/research', keywords: ['search', 'research', 'sources'] },
  { id: 'a-baseline', label: 'Retake the baseline', hint: 'Train', to: '/baseline', keywords: ['test', 'placement'] },
  { id: 'a-backup', label: 'Export a backup', hint: 'You › Settings', to: '/settings', keywords: ['export', 'backup', 'save'] },
  { id: 'a-media', label: 'Images and clips', hint: 'You › Settings', to: '/settings/media', keywords: ['media', 'art', 'pack'] },
  { id: 'a-diag', label: 'Diagnostics', hint: 'You › Settings', to: '/diagnostics', keywords: ['repair', 'errors', 'health'] },
];

export function buildPaletteIndex(): PaletteEntry[] {
  const entries: PaletteEntry[] = ACTIONS.map((a) => ({ ...a, group: 'Actions', keywords: a.keywords ?? [] }));
  entries.push({ id: 'g-today', group: 'Go to', label: 'Today', hint: 'Today', to: '/today', keywords: ['home', 'plan'] });
  for (const hub of HUBS) {
    for (const section of hub.sections) {
      if (section.hidden === true) continue;
      entries.push({
        id: `g-${hub.id}-${section.id}`, group: 'Go to', label: section.label, hint: hub.label, to: section.to,
        keywords: [hub.label, ...(SECTION_KEYWORDS[section.id] ?? [])],
      });
      // QA M2: a Codex view ("Moves", "Stances", "Combos", "Heat") is labelled
      // by its own name, not "Codex › Heat" — the breadcrumb lives in the hint.
      for (const child of section.children ?? []) {
        entries.push({
          id: `g-${hub.id}-${section.id}-${child.id}`, group: 'Go to', label: child.label,
          hint: `${hub.label} › ${section.label}`, to: child.to, keywords: [child.label],
        });
      }
    }
  }
  for (const move of loadMovesYoshimitsu()) {
    entries.push({
      id: `m-${move.id}`, group: 'Moves', label: move.input, hint: move.name ?? 'Study › Codex',
      to: `/codex/moves/${encodeURIComponent(move.id)}`,
      keywords: [move.name ?? '', ...(move.aliases ?? []), ...(move.altInputs ?? [])],
    });
  }
  for (const stance of loadStances()) {
    entries.push({ id: `s-${stance.id}`, group: 'Stances', label: stance.name, hint: stance.id, to: `/codex/stances/${encodeURIComponent(stance.id)}`, keywords: [stance.id] });
  }
  for (const combo of loadCombos()) {
    entries.push({ id: `c-${combo.id}`, group: 'Combos', label: combo.name, hint: 'Study › Codex › Combos', to: `/codex/combos/${encodeURIComponent(combo.id)}`, keywords: [] });
  }
  for (const character of loadRoster()) {
    if (character.name === 'Yoshimitsu') continue;
    entries.push({ id: `ch-${character.name}`, group: 'Characters', label: character.name, hint: 'Study › Matchups', to: `/matchups/${encodeURIComponent(character.name)}`, keywords: ['vs', 'matchup'] });
  }
  for (const node of loadCurriculum().nodes) {
    entries.push({ id: `n-${node.id}`, group: 'Lessons', label: node.title, hint: 'You › Path', to: `/path/${encodeURIComponent(node.id)}`, keywords: [] });
  }
  return entries;
}

const GROUP_ORDER: PaletteGroup[] = ['Actions', 'Go to', 'Moves', 'Stances', 'Characters', 'Combos', 'Lessons'];
const PER_GROUP = 6;

/** The seven QA M2 tiers, applied to one normal form of the query/entry. */
function tierScore(label: string, keywords: string[], hint: string, q: string): number {
  if (q === '') return 0;
  if (label === q) return 100;
  if (keywords.some((w) => w === q)) return 95;
  if (label.startsWith(q)) return 80;
  if (keywords.some((w) => w.startsWith(q))) return 60;
  if (label.includes(q)) return 50;
  if (keywords.some((w) => w.includes(q))) return 35;
  if (hint.includes(q)) return 10;
  return 0;
}

function score(entry: PaletteEntry, q: string, qDenotated: string): number {
  const keywords = entry.keywords.filter((w) => w !== '');
  const raw = tierScore(normalize(entry.label), keywords.map(normalize), normalize(entry.hint), q);
  // QA M2 notation: "b1+2"/"b+1+2" and "ff3"/"f,F+3" must find each other, but
  // an exact raw-label match (e.g. typing the label verbatim) still wins —
  // scaled below the raw tiers so it can never beat an exact raw match.
  const denotated = qDenotated === '' ? 0 : tierScore(denotate(entry.label), keywords.map(denotate), '', qDenotated) * 0.9;
  return Math.max(raw, denotated);
}

/** Best matches grouped in a fixed order, at most PER_GROUP per group. An
 * empty query returns every action and every "Go to" destination. */
export function searchPalette(index: PaletteEntry[], query: string): PaletteEntry[] {
  const q = normalize(query);
  if (q === '') return index.filter((e) => e.group === 'Actions' || e.group === 'Go to');
  const qDenotated = denotate(query);
  const scored = index
    .map((entry) => ({ entry, s: score(entry, q, qDenotated) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.entry.label.length - b.entry.label.length);
  // Groups appear in order of their best match ("kaz" puts Characters before a
  // move whose name merely contains it), ties in the fixed order.
  const best = new Map<PaletteGroup, number>();
  for (const x of scored) best.set(x.entry.group, Math.max(best.get(x.entry.group) ?? 0, x.s));
  const groups = [...GROUP_ORDER].filter((g) => best.has(g)).sort((a, b) => (best.get(b) ?? 0) - (best.get(a) ?? 0) || GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
  const out: PaletteEntry[] = [];
  for (const group of groups) {
    out.push(...scored.filter((x) => x.entry.group === group).slice(0, PER_GROUP).map((x) => x.entry));
  }
  return out;
}
