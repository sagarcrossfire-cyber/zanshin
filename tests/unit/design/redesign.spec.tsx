// Release 1.4.0 — redesign foundations: colour schemes persist and apply,
// the scene picks the screen's character, move names arrive decoded, and
// the frame-data key explains every value the move list shows.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SCHEMES, SCHEME_STORAGE_KEY, THEME_STORAGE_KEY, applyScheme, applyTheme, initTheme, isScheme, readSchemeChoice,
} from '../../../src/app/theme';
import { sceneCharacter } from '../../../src/components/decor/Scene';
import { FrameLegend } from '../../../src/components/codex/FrameLegend';
import { SUFFIX_TIPS, frameTier } from '../../../src/components/signature/FrameValue';
import { mapCargoRow } from '../../../src/data/import/wavu';
import { loadMovesYoshimitsu, loadStances } from '../../../src/data/packs';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.scheme;
});

describe('colour schemes', () => {
  it('reads, validates, applies and persists the dark scheme', () => {
    expect(readSchemeChoice()).toBe('manji');
    expect(isScheme('heat')).toBe(true);
    expect(isScheme('neon')).toBe(false);
    applyScheme('crimson');
    expect(document.documentElement.dataset.scheme).toBe('crimson');
    expect(window.localStorage.getItem(SCHEME_STORAGE_KEY)).toBe('crimson');
    expect(readSchemeChoice()).toBe('crimson');
    window.localStorage.setItem(SCHEME_STORAGE_KEY, 'garbage');
    expect(readSchemeChoice()).toBe('manji');
    expect(SCHEMES.map((s) => s.id)).toEqual(['manji', 'crimson', 'heat']);
  });

  it('initTheme applies the stored scheme and theme; applyTheme keeps an existing scheme', () => {
    window.localStorage.setItem(SCHEME_STORAGE_KEY, 'heat');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    initTheme();
    expect(document.documentElement.dataset.scheme).toBe('heat');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.scheme).toBe('heat');
  });
});

describe('scene character', () => {
  it('shows the opponent on a character page and Yoshimitsu elsewhere', () => {
    expect(sceneCharacter('/matchups/Devil%20Jin')).toBe('Devil Jin');
    expect(sceneCharacter('/matchups/Kazuya/notes')).toBe('Kazuya');
    expect(sceneCharacter('/matchups')).toBe('Yoshimitsu');
    expect(sceneCharacter('/today')).toBe('Yoshimitsu');
    expect(sceneCharacter('/matchups/%E0%A4%A')).toBe('Yoshimitsu');
  });
});

describe('move names are decoded', () => {
  it('the importer decodes HTML entities in Wavu move names', () => {
    const row = {
      'Move.alias': '', 'Move.alt': '', 'Move.block': '-9', 'Move.ch': '', 'Move.crush': '', 'Move.damage': '20',
      'Move.hit': '+4c', 'Move.id': 'Yoshimitsu-1,2', 'Move.input': '1,2', 'Move.name': ['Enma&', '039;s Flame &gt; Stab'].join('#'),
      'Move.notes': '', 'Move.num': 1, 'Move.parent': '', 'Move.recv': '', 'Move.startup': 'i10', 'Move.target': 'h,h', 'Move.tot': '',
    };
    const move = mapCargoRow(row as never, new Map(), { fetchedAt: '2026-10-31T00:00:00Z', patch: '3.02.02', source: 'wavu', status: 'unverified' } as never);
    expect(move.name).toBe("Enma's Flame > Stab");
  });

  it('the bundled pack carries no HTML entities in any name', () => {
    const bad = loadMovesYoshimitsu().filter((move) => /&(\u0023\d+|\u0023x[\da-f]+|[a-z]+);/i.test(move.name ?? ''));
    expect(bad.map((move) => move.name)).toEqual([]);
    expect(loadMovesYoshimitsu().some((move) => move.name === "Enma's Flame")).toBe(true);
  });
});

describe('frame-data key', () => {
  it('explains startup, block, hit, every suffix letter, hit levels, statuses and every stance', () => {
    render(<FrameLegend />);
    const legend = screen.getByTestId('frame-legend');
    for (const heading of ['Startup', 'On block', 'On hit', 'Letters after a value', 'Bracketed value', 'Hit level', 'How sure the number is', 'Stances']) {
      expect(within(legend).getByRole('heading', { name: new RegExp(heading) })).toBeInTheDocument();
    }
    for (const [letter, tip] of Object.entries(SUFFIX_TIPS)) {
      expect(within(legend).getByText(tip)).toBeInTheDocument();
      expect(within(legend).getAllByText(letter).length).toBeGreaterThan(0);
    }
    for (const stance of loadStances()) expect(within(legend).getAllByText(stance.name).length).toBeGreaterThan(0);
    for (const tier of ['Plus', 'Safe', 'Punishable', 'Launch punishable']) expect(within(legend).getByText(tier)).toBeInTheDocument();
    // The tier samples render in the tier they describe.
    expect(frameTier('-12')).toBe('punish');
    expect(legend.querySelector('.z-frame-value--launch')).not.toBeNull();
    expect(legend.querySelector('.z-frame-value--punish')).not.toBeNull();
  });

  it('the c suffix means the same in the tooltip and in speech (spec §4.7)', () => {
    expect(SUFFIX_TIPS.c).toBe('Opponent crouching');
  });
});

describe('gate criteria in plain words', () => {
  it('names every curriculum metric and falls back to spaced words', async () => {
    const { criteriaText, criterionLabel } = await import('../../../src/domain/engine/criteriaLabels');
    expect(criteriaText(['solidShare', 'drillSuccess'])).toBe('80% of nodes solid, drill success');
    expect(criterionLabel('someNewMetric')).toBe('some new metric');
  });
});
