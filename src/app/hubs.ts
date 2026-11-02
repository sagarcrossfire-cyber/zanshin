// 2.0 information architecture (docs/v2/PLAN.md M1, docs/v2/research/design.md §B.1).
// Five hubs follow Sagar's loop — plan, practise, reflect, learn, measure —
// and every route belongs to exactly one hub (or none: onboarding, the dev
// gallery). This file is the single source of that mapping: the dock, the
// rail, the section chips, the top-bar eyebrow and the palette all read it.
// Pure: no React, no storage.

export type HubId = 'today' | 'train' | 'coach' | 'study' | 'you';

export interface HubSection {
  id: string;
  label: string;
  /** Where the section's chip or rail row links. */
  to: string;
  /** Routes that belong to this section. */
  match: RegExp;
  /** Belongs to the hub but gets no chip (reached from inside screens or the palette). */
  hidden?: boolean;
  /** A second row of chips inside the section (the Codex's four views). */
  children?: HubSection[];
}

export interface Hub {
  id: HubId;
  label: string;
  /** A kanji mark for the hub (decorative, aria-hidden). */
  kanji: string;
  /** The hub's first screen. */
  root: string;
  sections: HubSection[];
}

export const HUBS: readonly Hub[] = [
  {
    id: 'today', label: 'Today', kanji: '今', root: '/today',
    sections: [{ id: 'today', label: 'Today', to: '/today', match: /^\/today\/?$/, hidden: true }],
  },
  {
    id: 'train', label: 'Train', kanji: '稽古', root: '/lab',
    sections: [
      { id: 'lab', label: 'Lab', to: '/lab', match: /^\/lab(\/|$)/ },
      { id: 'punish', label: 'Punish Trainer', to: '/punish', match: /^\/punish(\/|$)/ },
      { id: 'cards', label: 'Flashcards', to: '/cards', match: /^\/cards(\/|$)/ },
      { id: 'baseline', label: 'Baseline', to: '/baseline', match: /^\/baseline(\/|$)/, hidden: true },
    ],
  },
  {
    id: 'coach', label: 'Coach', kanji: '師', root: '/coach/ask',
    sections: [
      { id: 'ask', label: 'Ask', to: '/coach/ask', match: /^\/coach(\/ask)?\/?$/ },
      { id: 'review', label: 'Weekly review', to: '/coach/review', match: /^\/coach\/review\/?$/ },
      { id: 'debriefs', label: 'Debriefs', to: '/coach/debriefs', match: /^\/coach\/debriefs\/?$/ },
      { id: 'research', label: 'Look it up', to: '/coach/research', match: /^\/coach\/research\/?$/ },
    ],
  },
  {
    id: 'study', label: 'Study', kanji: '書', root: '/codex/moves',
    sections: [
      {
        id: 'codex', label: 'Codex', to: '/codex/moves', match: /^\/codex(\/|$)/,
        children: [
          { id: 'moves', label: 'Moves', to: '/codex/moves', match: /^\/codex\/moves(\/|$)/ },
          { id: 'stances', label: 'Stances', to: '/codex/stances', match: /^\/codex\/stances(\/|$)/ },
          { id: 'combos', label: 'Combos', to: '/codex/combos', match: /^\/codex\/combos(\/|$)/ },
          { id: 'heat', label: 'Heat', to: '/codex/heat', match: /^\/codex\/heat(\/|$)/ },
        ],
      },
      { id: 'matchups', label: 'Matchups', to: '/matchups', match: /^\/matchups(\/|$)/ },
      { id: 'playbook', label: 'Playbook', to: '/playbook', match: /^\/playbook(\/|$)/ },
      { id: 'patch', label: 'Patch Watch', to: '/patch', match: /^\/patch(\/|$)/ },
    ],
  },
  {
    id: 'you', label: 'You', kanji: '道', root: '/path',
    sections: [
      { id: 'path', label: 'Path', to: '/path', match: /^\/path(\/|$)/ },
      { id: 'matches', label: 'Matches', to: '/log', match: /^\/log(\/|$)/ },
      { id: 'progress', label: 'Progress', to: '/progress', match: /^\/progress(\/|$)/ },
      { id: 'settings', label: 'Settings', to: '/settings', match: /^\/(settings|diagnostics)(\/|$)/ },
    ],
  },
];

/** The hub a route belongs to, or null for routes outside the hubs. */
export function hubFor(pathname: string): Hub | null {
  for (const hub of HUBS) {
    if (hub.sections.some((section) => section.match.test(pathname))) return hub;
  }
  return null;
}

/** The section of its hub a route belongs to, or null. */
export function sectionFor(pathname: string): HubSection | null {
  for (const hub of HUBS) {
    const section = hub.sections.find((s) => s.match.test(pathname));
    if (section) return section;
  }
  return null;
}

/** The child view inside a section (e.g. Codex › Heat), or null. */
export function childFor(pathname: string): HubSection | null {
  return sectionFor(pathname)?.children?.find((child) => child.match.test(pathname)) ?? null;
}

/** Sections that get a chip or rail row. */
export function visibleSections(hub: Hub): HubSection[] {
  return hub.sections.filter((section) => section.hidden !== true);
}

export function hubById(id: HubId): Hub {
  const hub = HUBS.find((h) => h.id === id);
  if (!hub) throw new Error(`Unknown hub ${id}`);
  return hub;
}
