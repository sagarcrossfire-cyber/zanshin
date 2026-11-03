// 2.0 M1: every route belongs to exactly one hub (or none), the Codex views
// have their own chips, and the palette finds screens, moves, stances,
// characters and actions.
import { describe, expect, it } from 'vitest';
import { childFor, hubFor, HUBS, sectionFor, visibleSections } from '../../../src/app/hubs';

const ROUTES: Array<[string, string | null, string | null]> = [
  ['/today', 'today', 'today'],
  ['/lab', 'train', 'lab'],
  ['/lab/session/abc', 'train', 'lab'],
  ['/punish', 'train', 'punish'],
  ['/cards', 'train', 'cards'],
  ['/cards/review', 'train', 'cards'],
  ['/baseline', 'train', 'baseline'],
  ['/coach', 'coach', 'ask'],
  ['/coach/ask', 'coach', 'ask'],
  ['/coach/review', 'coach', 'review'],
  ['/coach/debriefs', 'coach', 'debriefs'],
  ['/coach/research', 'coach', 'research'],
  ['/codex/moves', 'study', 'codex'],
  ['/codex/moves/Yoshimitsu-1%2B4', 'study', 'codex'],
  ['/codex/stances', 'study', 'codex'],
  ['/codex/stances/KIN', 'study', 'codex'],
  ['/codex/combos', 'study', 'codex'],
  ['/codex/combos/x', 'study', 'codex'],
  ['/codex/heat', 'study', 'codex'],
  ['/matchups', 'study', 'matchups'],
  ['/matchups/Kazuya', 'study', 'matchups'],
  ['/playbook', 'study', 'playbook'],
  ['/patch', 'study', 'patch'],
  ['/path', 'you', 'path'],
  ['/path/n1-guard', 'you', 'path'],
  ['/log', 'you', 'matches'],
  ['/log/new', 'you', 'matches'],
  ['/log/import', 'you', 'matches'],
  ['/log/set-1', 'you', 'matches'],
  ['/log/set-1/edit', 'you', 'matches'],
  ['/progress', 'you', 'progress'],
  ['/settings', 'you', 'settings'],
  ['/settings/media', 'you', 'settings'],
  ['/diagnostics', 'you', 'settings'],
  ['/onboarding', null, null],
  ['/dev/gallery', null, null],
  ['/nowhere', null, null],
];

describe('hub map', () => {
  it.each(ROUTES)('%s belongs to hub %s, section %s', (path, hub, section) => {
    expect(hubFor(path)?.id ?? null).toBe(hub);
    expect(sectionFor(path)?.id ?? null).toBe(section);
  });

  it('has five hubs in loop order with Coach in the centre', () => {
    expect(HUBS.map((h) => h.id)).toEqual(['today', 'train', 'coach', 'study', 'you']);
  });

  it('every hub root belongs to its own hub', () => {
    for (const hub of HUBS) expect(hubFor(hub.root)?.id).toBe(hub.id);
  });

  it('Codex views are reachable as second-row chips, Heat included', () => {
    expect(childFor('/codex/heat')?.id).toBe('heat');
    expect(childFor('/codex/stances/KIN')?.id).toBe('stances');
    expect(childFor('/lab')).toBeNull();
    expect(sectionFor('/codex/heat')?.children?.map((c) => c.to)).toEqual(['/codex/moves', '/codex/stances', '/codex/combos', '/codex/heat']);
  });

  it('hidden sections (Today, Baseline) get no chip', () => {
    const train = HUBS.find((h) => h.id === 'train')!;
    expect(visibleSections(train).map((s) => s.id)).toEqual(['lab', 'punish', 'cards']);
    expect(visibleSections(HUBS[0]!)).toEqual([]);
  });
});
