// Seed-card generation (§11.4) and missed-question cards (§5.10/AC-PUN-3).
// Generation is pure (bundled packs); persistence/idempotency uses the
// fake-indexeddb pattern from tests/unit/data/repos.spec.ts.
import { describe, expect, it } from 'vitest';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
if (fakeAvailable) {
  const globals = globalThis as Record<string, unknown>;
  globals['indexedDB'] = fakeModule?.['indexedDB'];
  globals['IDBKeyRange'] = fakeModule?.['IDBKeyRange'];
}

const repos = fakeAvailable ? await import('../../src/data/repos/index') : null;
const dbModule = fakeAvailable ? await import('../../src/data/db') : null;
const cardsService = fakeAvailable ? await import('../../src/services/cards') : null;

import { bestPunisherFor } from '../../src/services/punish';
import { loadMovesYoshimitsu, loadPunishers, loadStances } from '../../src/data/packs';
import { blockTier } from '../../src/domain/codex/filters';
import { spokenLabel } from '../../src/domain/notation/speak';
import { practiceDay } from '../../src/domain/engine/srs';

const NOW = '2026-10-29T17:00:00';

describe('generateSeedCards', () => {
  it('generates 111 cards with the expected per-deck counts', () => {
    if (cardsService === null) return;
    const cards = cardsService.generateSeedCards(NOW);
    const byDeck = new Map<string, number>();
    for (const card of cards) byDeck.set(card.deck, (byDeck.get(card.deck) ?? 0) + 1);
    expect(cards).toHaveLength(111);
    expect(byDeck.get('Notation')).toBe(40);
    expect(byDeck.get('Core moves')).toBe(40);
    expect(byDeck.get('Punish ladder')).toBe(9);
    expect(byDeck.get('Crouching punishes')).toBe(9);
    expect(byDeck.get('Stances')).toBe(10);
    expect(byDeck.get('Heat kit')).toBe(1);
    expect(byDeck.get('Counterplay')).toBe(1);
    expect(byDeck.get('Universal systems')).toBe(1);
  });

  it('uses deterministic ids of the form card-seed-<templateId>-<slug>', () => {
    if (cardsService === null) return;
    const a = cardsService.generateSeedCards(NOW);
    const b = cardsService.generateSeedCards(NOW);
    expect(a).toEqual(b);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    for (const card of a) {
      expect(card.id).toMatch(/^card-seed-tpl-[a-z-]+-[a-z0-9-]+$/);
      expect(card.createdAt).toBe(NOW);
      expect(card.templateId).toBeDefined();
    }
    expect(a.find((c) => c.templateId === 'tpl-punish-ladder' && c.front.startsWith('−14'))?.id)
      .toBe('card-seed-tpl-punish-ladder-neg14');
  });

  it('notation cards pair the input with its spoken label and name', () => {
    if (cardsService === null) return;
    const cards = cardsService.generateSeedCards(NOW);
    const moves = loadMovesYoshimitsu();
    const notation = cards.filter((c) => c.templateId === 'tpl-notation');
    expect(notation).toHaveLength(40);
    for (const card of notation) {
      const move = moves.find((m) => m.input === card.front);
      expect(move).toBeDefined();
      const expected = move?.name !== undefined
        ? `${spokenLabel(card.front)} (${move.name})`
        : spokenLabel(card.front);
      expect(card.back).toBe(expected);
      expect(card.refs).toEqual([move?.id]);
    }
  });

  it('core-block cards use the published block value and the existing tier wording', () => {
    if (cardsService === null) return;
    const cards = cardsService.generateSeedCards(NOW);
    const moves = loadMovesYoshimitsu();
    const tierLabels: Record<string, string> = {
      plus: 'plus', safe: 'safe', punishable: 'punishable', launch: 'launch punishable',
    };
    for (const card of cards.filter((c) => c.templateId === 'tpl-core-block')) {
      const move = moves.find((m) => m.input === card.front.replace('What is ', '').replace(' on block?', ''));
      expect(move).toBeDefined();
      if (move === undefined) continue;
      const tier = blockTier(move);
      const expectedTier = tier === null ? 'unknown' : tierLabels[tier];
      const expectedBlock = move.block !== undefined ? move.block.replace(/-/g, '−') : '—';
      expect(card.back).toBe(`${expectedBlock}: ${expectedTier}`);
      expect(card.front).toBe(`What is ${move.input} on block?`);
    }
  });

  it('ladder and crouch cards use the §5.10 best row for the enemy value', () => {
    if (cardsService === null) return;
    const cards = cardsService.generateSeedCards(NOW);
    const punishers = loadPunishers();
    for (const card of cards.filter((c) => c.templateId === 'tpl-punish-ladder')) {
      const enemy = -Number(card.id.split('-').at(-1)?.replace('neg', ''));
      const best = bestPunisherFor(enemy, 'standing', false, punishers);
      expect(best).not.toBeNull();
      expect(card.back).toBe(`${best?.input} (${best?.comboDamage ?? best?.damage}, ${best?.onHit})`);
      expect(card.front).toBe(`${String(enemy).replace(/-/g, '−')} standing: best punish?`);
    }
    for (const card of cards.filter((c) => c.templateId === 'tpl-crouch-punish')) {
      const enemy = -Number(card.id.split('-').at(-1)?.replace('neg', ''));
      const best = bestPunisherFor(enemy, 'crouching', false, punishers);
      expect(best).not.toBeNull();
      const expected = best?.onHit !== '' ? `${best?.input}, which ${best?.onHit}` : (best?.input as string);
      expect(card.back).toBe(expected);
    }
  });

  it('stance cards list entries with notes, and static cards use the literal templates', () => {
    if (cardsService === null) return;
    const cards = cardsService.generateSeedCards(NOW);
    const stances = loadStances();
    const stanceCards = cards.filter((c) => c.templateId === 'tpl-stances');
    expect(stanceCards).toHaveLength(stances.length);
    for (const card of stanceCards) {
      const stance = stances.find((s) => card.front.includes(s.name));
      expect(stance).toBeDefined();
      if (stance === undefined) continue;
      for (const entry of stance.entries) {
        expect(card.back).toContain(entry.input);
        if (entry.note !== undefined) expect(card.back).toContain(entry.note);
      }
    }
    const heat = cards.find((c) => c.templateId === 'tpl-heat-engagers');
    expect(heat?.front).toBe('Name his five Heat Engagers');
    expect(heat?.back).toBe('3,1, f+1+2, b+2,2, KIN.f+2, DGF.4');
    const throwCard = cards.find((c) => c.templateId === 'tpl-generic-throw');
    expect(throwCard?.back).toBe('1. Never 1+2');
  });
});

describe.skipIf(!fakeAvailable)('ensureSeedCards idempotency', () => {
  it('a second call creates nothing new', async () => {
    if (repos === null || dbModule === null || cardsService === null) return;
    await dbModule.resetDbForTests();
    const first = await cardsService.ensureSeedCards(NOW, '04:00');
    expect(first.created).toBe(111);
    expect(first.statesCreated).toBe(111);
    expect((await repos.cardsRepo.all()).length).toBe(111);
    const second = await cardsService.ensureSeedCards(NOW, '04:00');
    expect(second.created).toBe(0);
    expect(second.statesCreated).toBe(0);
    expect((await repos.cardsRepo.all()).length).toBe(111);
    expect((await repos.cardStatesRepo.all()).length).toBe(111);
  });

  it('does not recreate a state that already exists for a seed card', async () => {
    if (repos === null || dbModule === null || cardsService === null) return;
    await dbModule.resetDbForTests();
    await cardsService.ensureSeedCards(NOW, '04:00');
    // Grade one card, then re-ensure: its state must survive untouched.
    const graded = await cardsService.gradeAndSchedule(
      'card-seed-tpl-notation-1-4', 2, '2026-10-30T20:00:00', '04:00',
    );
    await cardsService.ensureSeedCards('2026-10-30T20:00:00', '04:00');
    expect(await repos.cardStatesRepo.get('card-seed-tpl-notation-1-4')).toEqual(graded);
  });
});

describe('missed-question cards', () => {
  it('builds a deterministic Punish ladder card from a missed ladder question', () => {
    const best = bestPunisherFor(-13, 'standing', false, loadPunishers());
    if (cardsService === null) return;
    const card = cardsService.cardForMissedQuestion(
      {
        id: 'ladder--13-standing-noheat',
        front: 'The opponent\'s move is −13 on block. You are standing. Best punisher?',
        correctInput: 'NSS.1+4',
        explanation: 'Best punisher: NSS.1+4 (67 damage, +14 +64a on hit).',
      },
      best,
      NOW,
    );
    expect(card.id).toBe('card-missed-ladder--13-standing-noheat');
    expect(card.deck).toBe('Punish ladder');
    expect(card.front).toContain('−13 on block');
    expect(card.back).toContain('NSS.1+4');
    expect(card.back).toContain('Best punisher: NSS.1+4');
    expect(card.refs).toEqual([best?.moveId]);
    expect(card.createdAt).toBe(NOW);
    // Missing the same question again yields the same card id.
    const again = cardsService.cardForMissedQuestion(
      {
        id: 'ladder--13-standing-noheat',
        front: 'The opponent\'s move is −13 on block. You are standing. Best punisher?',
        correctInput: 'NSS.1+4',
        explanation: 'Best punisher: NSS.1+4 (67 damage, +14 +64a on hit).',
      },
      best,
      '2026-10-30T20:00:00',
    );
    expect(again.id).toBe(card.id);
  });
});

describe.skipIf(!fakeAvailable)('ensureCard for missed questions', () => {
  it('persists the card with a fresh state due on its creation day', async () => {
    if (repos === null || dbModule === null) return;
    await dbModule.resetDbForTests();
    const best = bestPunisherFor(-13, 'standing', false, loadPunishers());
    if (cardsService === null) return;
    const card = cardsService.cardForMissedQuestion(
      {
        id: 'ladder--13-standing-noheat',
        front: 'The opponent\'s move is −13 on block. You are standing. Best punisher?',
        correctInput: 'NSS.1+4',
        explanation: 'Best punisher: NSS.1+4.',
      },
      best,
      NOW,
    );
    const first = await cardsService.ensureCard(card, '04:00');
    expect(first.stateCreated).toBe(true);
    const state = await repos.cardStatesRepo.get(card.id);
    expect(state?.reps).toBe(0);
    expect(state?.history).toEqual([]);
    expect(state?.due).toBe(practiceDay(NOW, '04:00'));
    const second = await cardsService.ensureCard(card, '04:00');
    expect(second.stateCreated).toBe(false);
    expect((await repos.cardsRepo.all()).length).toBe(1);
  });
});
