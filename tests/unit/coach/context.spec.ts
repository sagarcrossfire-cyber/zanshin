// Spec §8.3 — context bundle: headed sections, keyword/alias retrieval capped
// at 12, provenance cited, truncation drops oldest logs first, never Codex.
import {
  buildContext, estimateTokens, retrieveCodexEntries, type CoachCodexEntry, type CoachContextState,
} from '../../../src/domain/coach/context';

const CODEX: CoachCodexEntry[] = [
  {
    input: 'df+2', name: 'Flashing Steel', aliases: ['CD2'], tags: ['launcher', 'punisher'],
    block: '-7', hit: '+34a (+24)',
    provenance: { source: 'Wavu Wiki', patch: '3.02.02', status: 'sourced' },
  },
  {
    input: '1+4', name: 'Soul Stealer', aliases: ['Flash'], tags: ['panic', 'punisher'],
    block: '-20', hit: '+14c',
    provenance: { source: 'Wavu Wiki', patch: '3.02.02', status: 'verified' },
  },
  {
    input: 'b+2,2', name: 'Soul Stealer 2', aliases: [], tags: ['heat-engager'],
    block: '-9', hit: '+2a',
    provenance: { source: 'Wavu Wiki', patch: '3.02.02', status: 'verified' },
  },
];

function state(overrides: Partial<CoachContextState> = {}): CoachContextState {
  return {
    profile: { displayName: 'Sagar', platform: 'ps5', currentStage: 3, targetRank: 'Tekken King', sessionMinutes: 30, weeklyMinutes: 150 },
    currentStage: 3,
    mastery: [{ nodeTitle: 'Standing punishers', state: 'practicing', score: 0.62, stageIndex: 3 }],
    rustyNodes: [{ nodeTitle: 'BnB', score: 0.45 }],
    sessions: [
      { day: '2026-10-29', minutes: 30, drills: [{ title: 'BnB', successRate: 0.6, sets: 3 }] },
      { day: '2026-10-30', minutes: 28, drills: [{ title: 'Punish ladder', successRate: 0.8, sets: 3 }] },
    ],
    kpis: [{ label: 'Missed punishes per game', value: '2.6', sample: '10 games' }],
    weaknesses: [{ label: 'Missed punishes', severity: 0.3, value: '2.6', target: '2.0' }],
    plan: {
      date: '2026-10-30', dayType: 'full',
      blocks: [{ kind: 'drill', minutes: 12, reason: 'Missed punishes 2.6 per game vs target 2.0' }],
    },
    codex: CODEX,
    dataStatus: { patch: '3.02.02', openConflicts: 2 },
    ...overrides,
  };
}

describe('retrieveCodexEntries', () => {
  it('matches by input substring, alias and tag', () => {
    expect(retrieveCodexEntries('What is df+2 on block?', CODEX).map((e) => e.input)).toContain('df+2');
    expect(retrieveCodexEntries('How do I Flash?', CODEX).map((e) => e.input)).toContain('1+4');
    expect(retrieveCodexEntries('Which launcher should I use?', CODEX).map((e) => e.input)).toContain('df+2');
    expect(retrieveCodexEntries('Tell me about heat engagers', CODEX).map((e) => e.input)).toContain('b+2,2');
  });

  it('returns nothing for an empty or unmatched question', () => {
    expect(retrieveCodexEntries('', CODEX)).toEqual([]);
    expect(retrieveCodexEntries('What is the weather?', CODEX)).toEqual([]);
  });

  it('caps at 12 entries, best matches first', () => {
    const many: CoachCodexEntry[] = Array.from({ length: 20 }, (_, i) => ({
      input: `move${i}`, aliases: ['Flash'], tags: [],
      provenance: { source: 'Wavu Wiki', patch: '3.02.02', status: 'sourced' },
    }));
    expect(retrieveCodexEntries('Flash', many)).toHaveLength(12);
  });
});

describe('buildContext', () => {
  it('has headed sections and cites provenance', () => {
    const bundle = buildContext('What is df+2 on block?', state());
    expect(bundle).toContain('# ZANSHIN coach context');
    expect(bundle).toContain('## Profile');
    expect(bundle).toContain('## Mastery');
    expect(bundle).toContain('## Rusty nodes');
    expect(bundle).toContain('## Last 14 days');
    expect(bundle).toContain('## KPIs (last 10–20 games)');
    expect(bundle).toContain('## Weaknesses');
    expect(bundle).toContain("## Today's plan");
    expect(bundle).toContain('## Codex entries');
    expect(bundle).toContain('## Data status');
    expect(bundle).toContain('df+2');
    expect(bundle).toContain('Source: Wavu Wiki, patch 3.02.02, sourced.');
    expect(bundle).toContain('Open conflicts: 2.');
  });

  it('stays under ~6000 tokens for a realistic state', () => {
    expect(estimateTokens(buildContext('df+2', state()))).toBeLessThanOrEqual(6000);
  });

  it('truncates the oldest logs first and never cuts Codex entries', () => {
    const hugeSessions = Array.from({ length: 60 }, (_, i) => ({
      day: `day-${i}`,
      minutes: 30,
      drills: Array.from({ length: 8 }, (_, j) => ({
        title: `A very long drill name number ${j} with lots of detail padded out to make the bundle large`,
        successRate: 0.7, sets: 3,
      })),
    }));
    const bundle = buildContext('What is df+2 on block?', state({ sessions: hugeSessions }));
    expect(estimateTokens(bundle)).toBeLessThanOrEqual(6000);
    // The retrieved Codex entry survives truncation whole.
    expect(bundle).toContain('df+2');
    expect(bundle).toContain('Source: Wavu Wiki, patch 3.02.02, sourced.');
    // The oldest session log is gone.
    expect(bundle).not.toContain('day-0:');
  });

  it('handles an empty state without errors', () => {
    const bundle = buildContext('df+2', state({
      mastery: [], rustyNodes: [], sessions: [], kpis: [], weaknesses: [], plan: null, codex: [],
    }));
    expect(bundle).toContain('No sessions logged.');
    expect(bundle).toContain('No plan.');
  });
});
