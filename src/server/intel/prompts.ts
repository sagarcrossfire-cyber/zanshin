// Release 1.3.0 — prompts, source allowlist and limits for the intel function.
// Everything the model is told lives here, so it can be read in one place.
import type { WebSearchTool } from './perplexity';

/** Sites a research answer may draw on. Frame data still only ever comes
 * from the app's own Wavu pack; these are for prose and analysis. */
export const TEKKEN_SOURCES = [
  'wavu.wiki',
  'tekkendocs.com',
  'tekken.com',
  'bandainamcoent.com',
  'reddit.com',
  'eventhubs.com',
  'dashfight.com',
  'youtube.com',
  'tekkenzaibatsu.com',
];

export const RESEARCH_MAX_OUTPUT_TOKENS = 450;
export const PRIMER_MAX_OUTPUT_TOKENS = 550;
export const PATCH_MAX_OUTPUT_TOKENS = 500;
export const COACH_MAX_OUTPUT_TOKENS = 600;

export type Recency = 'hour' | 'day' | 'week' | 'month' | 'year';

export function webSearchTool(recency?: Recency): WebSearchTool {
  return {
    filters: {
      search_domain_filter: TEKKEN_SOURCES,
      ...(recency ? { search_recency_filter: recency } : {}),
    },
    max_results: 6,
    max_tokens: 5000,
    max_tokens_per_page: 1000,
    search_type: 'fast',
    type: 'web_search',
  };
}

const SHARED_RULES = `Rules:
- You are writing for one Tekken 8 player, Sagar, who plays Yoshimitsu. Write to him directly, plainly, no hype.
- Cite sources inline as [1], [2] matching the search result ids. Only claim what a source supports; if the sources do not cover something, say so in one line.
- Never state frame data as fact. If a source gives a frame number, write it as "reported" (for example "reported -13 on block") so the app can mark it unverified; his app verifies frames from Wavu Wiki itself.
- Write Tekken notation the way Wavu Wiki writes it (f,f+2 · d/f+1 · WS 4 · 1+4).
- Prefer concrete, repeatable advice over generalities.`;

export const RESEARCH_INSTRUCTIONS = `You answer Tekken 8 questions with web research for ZANSHIN, a personal Yoshimitsu coaching app.
${SHARED_RULES}
- At most 180 words. Short paragraphs or a short list. No headings.`;

export function primerInstructions(): string {
  return `You write a matchup primer for ZANSHIN, a personal Yoshimitsu coaching app, about how Yoshimitsu (Tekken 8) should play against one opponent character.
${SHARED_RULES}
- Use exactly these five short sections, each a bold title line followed by 2 to 4 bullets: **Their plan**, **Punish these** (name moves by input and what they lead to), **Duck or step these**, **Yoshimitsu's answers**, **Watch for**.
- At most 260 words in total.`;
}

export function primerInput(character: string): string {
  return `Opponent character: ${character}. Write the Yoshimitsu vs ${character} primer for Tekken 8 (current season).`;
}

export const PATCH_INSTRUCTIONS = `You explain Tekken 8 balance patch changes for ZANSHIN, a personal Yoshimitsu coaching app.
${SHARED_RULES}
- For each changed move listed in the input, write one bullet: the move's input, what changed in practice, and what Sagar should do about it. If sources say nothing about a move, write "no analysis found" for it.
- Then one closing line: the single most important thing to re-verify in Practice mode.
- At most 220 words.`;

export interface PatchChange {
  moveId: string;
  input: string;
  name?: string;
  field: string;
  before: string;
  after: string;
}

export function patchInput(revision: string, patchLabel: string | undefined, changes: PatchChange[]): string {
  const lines = changes.slice(0, 25).map((change) =>
    `- ${change.input}${change.name ? ` (${change.name})` : ''}: ${change.field} ${change.before} → ${change.after}`);
  return `Game: Tekken 8${patchLabel ? `, patch ${patchLabel}` : ''}. Wavu Wiki revision ${revision}.
Yoshimitsu moves whose data changed:
${lines.join('\n')}
${changes.length > 25 ? `(${changes.length - 25} more changes not listed)\n` : ''}Explain these changes.`;
}
