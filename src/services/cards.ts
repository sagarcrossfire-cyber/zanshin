// Flashcard generation and scheduling — spec §5.15 / §7.6 / §11.4. Every
// card derives from the bundled packs and card templates; no card content
// is invented here. Scheduling itself lives in src/domain/engine/srs.ts
// (gradeCard / practiceDay / dueCount) and is never re-implemented here.
//
// Frame-advantage tiers reuse the existing rule: blockTier() in
// src/domain/codex/filters.ts has the same thresholds as the riskText.ts
// sentences (plus above 0, safe to -9, punishable to -14, launch
// punishable at -15 or worse); the tier wording ("plus", "safe",
// "punishable", "launch punishable") is the §11.4 template note's wording.
import { blockTier } from '../domain/codex/filters';
import {
  DEFAULT_DAY_BOUNDARY, gradeCard, practiceDay,
  type CardState as SrsCardState, type Grade,
} from '../domain/engine/srs';
import { blockLabel, rowsFromPack } from './punish';
import { bestPunisher, type PunisherRow } from '../domain/engine/punish';
import {
  loadCardTemplates, loadMovesYoshimitsu, loadPunishers, loadStances,
} from '../data/packs';
import { cardsRepo, cardStatesRepo } from '../data/repos';
import { spokenLabel } from '../domain/notation/speak';
import type { Card, CardState, Move, Settings, Stance } from '../data/schemas';

/** §7.6 defaults: 10 new cards and 60 reviews per day. Used when no
 * settings row exists yet; stored settings (newCardsPerDay /
 * reviewsPerDay) win when present. */
export const DEFAULT_CARD_CAPS = { newPerDay: 10, reviewsPerDay: 60 } as const;

export interface ReviewCaps {
  newPerDay: number;
  reviewsPerDay: number;
}

/** Daily caps from settings, falling back to the §7.6 defaults. Note:
 * the seeded settings row currently stores reviewsPerDay 20 (bootstrap),
 * not the §7.6 60 — the stored value wins here; see the build report. */
export function reviewCaps(
  settings: Pick<Settings, 'newCardsPerDay' | 'reviewsPerDay'> | null | undefined,
): ReviewCaps {
  if (settings === null || settings === undefined) return { ...DEFAULT_CARD_CAPS };
  return { newPerDay: settings.newCardsPerDay, reviewsPerDay: settings.reviewsPerDay };
}

/**
 * Local wall-clock ISO string (no timezone suffix), e.g.
 * "2026-10-29T17:02:51". The SRS practice-day logic reads wall-clock
 * fields from the string, so UTC strings would roll the day over at the
 * wrong hour in the user's timezone.
 */
export function wallClockIso(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** The 40 §10.6 core-move inputs. Mirror of SECTION_10_6_INPUTS in
 * scripts/validate-data.ts, which is the authority; keep the two in sync. */
const CORE_MOVE_INPUTS: ReadonlySet<string> = new Set([
  '1', '1,1', '2,2', '4', 'df+4', 'df+1', 'df+1,4', 'df+1,2', 'b+2,2', 'b+2,1',
  'df+2', 'uf+3', '3,1', '3,2,1+2', '3~4', 'f+1+2', 'f,f,F+3', 'f,n,d,df+2',
  'f,n,d,df+1', 'SS.1', 'hFC.df+4', 'db+4', 'd+2,2,2', 'uf+4', 'f,F+4', 'b+1',
  '1+4', 'b+3', 'b+4', 'FC.DF+1', 'f+4', 'ub+1+2', 'd+1', 'ws4', 'ws1,2',
  'ws2,1', '1+3', '2+4', '2+3', 'R.df+1+2',
]);

/** Core moves: one row per §10.6 input, first pack row per input, pack order. */
function coreMoves(moves: Move[]): Move[] {
  const seen = new Set<string>();
  const core: Move[] = [];
  for (const move of moves) {
    if (!CORE_MOVE_INPUTS.has(move.input) || seen.has(move.input)) continue;
    seen.add(move.input);
    core.push(move);
  }
  return core;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cardId(templateId: string, slug: string): string {
  return `card-seed-${templateId}-${slug}`;
}

const TIER_LABELS: Record<string, string> = {
  plus: 'plus',
  safe: 'safe',
  punishable: 'punishable',
  launch: 'launch punishable',
};

/** Tier wording for a core-move card, from the existing block-tier rule. */
function tierLabel(move: Move): string {
  const tier = blockTier(move);
  if (tier === null) return 'unknown';
  return TIER_LABELS[tier] ?? 'unknown';
}

/** Block text for a core-move card: the published value, minus as −. */
function blockText(move: Move): string {
  return move.block !== undefined ? move.block.replace(/-/g, '−') : '—';
}

function stanceBack(stance: Stance): string {
  if (stance.entries.length === 0) return 'No stance entries in the pack.';
  return stance.entries
    .map((entry) =>
      entry.note !== undefined ? `${entry.input} (${entry.note})` : entry.input,
    )
    .join(', ');
}

/**
 * All seed cards from the 8 templates (§11.4): 40 notation + 40 core-block
 * + 9 punish-ladder + 9 crouching + 10 stances + 3 static = 111 cards.
 * Pure: packs are loaded from the bundled loaders; ids are deterministic.
 * Ladder/crouch cards use the §5.10 best row for the enemy value (Heat
 * off) — the same rule as the quiz and the ladder display — not the
 * per-rung row the §10.7 table lists; see the build report.
 */
export function generateSeedCards(nowIso: string): Card[] {
  const templates = loadCardTemplates().templates;
  const byId = new Map(templates.map((template) => [template.id, template]));
  const moves = loadMovesYoshimitsu();
  const core = coreMoves(moves);
  const punishers = loadPunishers();
  const rows = rowsFromPack(punishers);
  const stances = loadStances();
  const cards: Card[] = [];

  const notation = byId.get('tpl-notation');
  if (notation !== undefined) {
    for (const move of core) {
      const spoken = spokenLabel(move.input);
      cards.push({
        id: cardId(notation.id, slugify(move.input)),
        deck: notation.deck,
        templateId: notation.id,
        front: move.input,
        back: move.name !== undefined ? `${spoken} (${move.name})` : spoken,
        refs: [move.id],
        createdAt: nowIso,
      });
    }
  }

  const coreBlock = byId.get('tpl-core-block');
  if (coreBlock !== undefined) {
    for (const move of core) {
      cards.push({
        id: cardId(coreBlock.id, slugify(move.input)),
        deck: coreBlock.deck,
        templateId: coreBlock.id,
        front: `What is ${move.input} on block?`,
        back: `${blockText(move)}: ${tierLabel(move)}`,
        refs: [move.id],
        createdAt: nowIso,
      });
    }
  }

  const enemyValues = [...new Set(rows.map((row) => row.enemy))]
    .filter((enemy) => enemy >= -18 && enemy <= -6)
    .sort((a, b) => b - a);

  const punishLadder = byId.get('tpl-punish-ladder');
  if (punishLadder !== undefined) {
    for (const enemy of enemyValues) {
      const best = bestPunisher(enemy, 'standing', false, rows);
      if (best === null) continue;
      cards.push({
        id: cardId(punishLadder.id, `neg${Math.abs(enemy)}`),
        deck: punishLadder.deck,
        templateId: punishLadder.id,
        front: `${blockLabel(enemy)} standing: best punish?`,
        back: `${best.input} (${best.comboDamage ?? best.damage}, ${best.onHit})`,
        refs: [best.moveId],
        createdAt: nowIso,
      });
    }
  }

  const crouchPunish = byId.get('tpl-crouch-punish');
  if (crouchPunish !== undefined) {
    for (const enemy of enemyValues) {
      const best = bestPunisher(enemy, 'crouching', false, rows);
      if (best === null) continue;
      cards.push({
        id: cardId(crouchPunish.id, `neg${Math.abs(enemy)}`),
        deck: crouchPunish.deck,
        templateId: crouchPunish.id,
        front: `${blockLabel(enemy)} after blocking a low?`,
        back: best.onHit !== '' ? `${best.input}, which ${best.onHit}` : best.input,
        refs: [best.moveId],
        createdAt: nowIso,
      });
    }
  }

  const stancesTemplate = byId.get('tpl-stances');
  if (stancesTemplate !== undefined) {
    for (const stance of stances) {
      cards.push({
        id: cardId(stancesTemplate.id, slugify(stance.id)),
        deck: stancesTemplate.deck,
        templateId: stancesTemplate.id,
        front: `How do you enter ${stance.name}?`,
        back: stanceBack(stance),
        refs: [],
        createdAt: nowIso,
      });
    }
  }

  for (const template of templates) {
    if (template.source !== 'static') continue;
    cards.push({
      id: cardId(template.id, 'static'),
      deck: template.deck,
      templateId: template.id,
      front: template.frontTemplate,
      back: template.backTemplate,
      refs: [],
      createdAt: nowIso,
    });
  }

  return cards;
}

/** Fresh schedule state for a never-graded card, due on its creation day. */
export function freshCardState(cardId: string, nowIso: string, boundary: string): CardState {
  return {
    cardId,
    reps: 0,
    lapses: 0,
    ease: 2.5,
    intervalDays: 0,
    due: practiceDay(nowIso, boundary),
    history: [],
  };
}

/**
 * Write a card if it is not already stored, and create a fresh state for
 * it when it has none. Idempotent: re-ensuring the same card changes
 * nothing. Used by both the missed-question flow and the problem-move
 * flow (which currently creates its own card via matchups; this helper
 * is the shared ensure step for punish misses).
 */
export async function ensureCard(
  card: Card,
  boundary: string,
): Promise<{ card: Card; stateCreated: boolean }> {
  const stored = await cardsRepo.put(card);
  const existingState = await cardStatesRepo.get(card.id);
  if (existingState !== undefined) return { card: stored, stateCreated: false };
  await cardStatesRepo.put(freshCardState(card.id, card.createdAt, boundary));
  return { card: stored, stateCreated: true };
}

/**
 * Write any missing seed cards and create fresh states for seed cards
 * without one. Idempotent: a second call creates nothing new. Returns
 * the counts created, for the screen's confirmation message.
 */
export async function ensureSeedCards(
  nowIso: string,
  boundary: string,
): Promise<{ created: number; statesCreated: number }> {
  const seed = generateSeedCards(nowIso);
  const existing = new Set((await cardsRepo.all()).map((card) => card.id));
  let created = 0;
  let statesCreated = 0;
  for (const card of seed) {
    const isNew = !existing.has(card.id);
    const result = await ensureCard(card, boundary);
    if (isNew) created += 1;
    if (result.stateCreated) statesCreated += 1;
  }
  return { created, statesCreated };
}

// ---------- Missed-question cards ----------

/** The minimum a missed-question card needs: the shown question text, the
 * correct answer and the explanation shown after answering. */
export interface MissedQuestionInput {
  id: string;
  front: string;
  correctInput: string;
  explanation: string;
}

/**
 * A flashcard for a missed quiz question, in the "Punish ladder" deck,
 * scheduled by §7.6 via ensureCard. The id is deterministic from the
 * question id, so missing the same question twice creates one card.
 */
export function cardForMissedQuestion(
  question: MissedQuestionInput,
  bestRow: PunisherRow | null,
  nowIso: string,
): Card {
  const answer =
    bestRow !== null
      ? `${bestRow.input} (${bestRow.comboDamage ?? bestRow.damage}, ${bestRow.onHit})`
      : question.correctInput;
  return {
    id: `card-missed-${question.id}`,
    deck: 'Punish ladder',
    front: question.front,
    back: `${answer}: ${question.explanation}`,
    refs: bestRow !== null ? [bestRow.moveId] : [],
    createdAt: nowIso,
  };
}

// ---------- Review queue ----------

export interface ReviewQueue {
  newCards: Card[];
  reviewCards: Card[];
  /** Due cards left out by the daily caps — still queued, never hidden. */
  overdueCount: number;
}

function compareCards(a: Card, b: Card): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Today's review queue (pure). A card is NEW when its state has reps 0
 * and an empty history (never graded); a card without a state counts as
 * new. Reviews are due cards with a non-empty history. Only cards due on
 * or before `day` are queued (new cards are due on their creation day).
 * New cards come first (oldest first), capped at newPerDay; reviews
 * follow (earliest due first), capped at reviewsPerDay. Cards beyond
 * the caps are counted in overdueCount, not dropped silently.
 */
export function reviewQueue(
  cards: Card[],
  states: CardState[],
  day: string,
  caps: ReviewCaps,
): ReviewQueue {
  const stateById = new Map(states.map((state) => [state.cardId, state]));
  const newCandidates: Card[] = [];
  const reviewCandidates: Array<{ card: Card; due: string }> = [];
  for (const card of cards) {
    const state = stateById.get(card.id);
    if (state === undefined) {
      newCandidates.push(card);
      continue;
    }
    if (state.due > day) continue;
    if (state.reps === 0 && state.history.length === 0) {
      newCandidates.push(card);
    } else {
      reviewCandidates.push({ card, due: state.due });
    }
  }
  newCandidates.sort(compareCards);
  reviewCandidates.sort(
    (a, b) => a.due.localeCompare(b.due) || compareCards(a.card, b.card),
  );
  const newCards = newCandidates.slice(0, caps.newPerDay);
  const reviewCards = reviewCandidates.slice(0, caps.reviewsPerDay).map((entry) => entry.card);
  const overdueCount =
    newCandidates.length - newCards.length + (reviewCandidates.length - reviewCards.length);
  return { newCards, reviewCards, overdueCount };
}

/** Grade one card and persist its new state. Due = today's practice day
 * + the new interval (§7.6), computed by gradeCard. When the card has
 * no state yet, a fresh state is graded from. */
export async function gradeAndSchedule(
  cardId: string,
  grade: Grade,
  nowIso: string,
  boundary: string = DEFAULT_DAY_BOUNDARY,
): Promise<CardState> {
  const existing = await cardStatesRepo.get(cardId);
  const start: SrsCardState =
    existing !== undefined
      ? {
          cardId: existing.cardId,
          reps: existing.reps,
          lapses: existing.lapses,
          ease: existing.ease,
          intervalDays: existing.intervalDays,
          due: existing.due,
          ...(existing.lastGrade !== undefined ? { lastGrade: existing.lastGrade } : {}),
          history: existing.history,
        }
      : freshCardState(cardId, nowIso, boundary);
  const next = gradeCard(start, grade, nowIso, boundary);
  const stored: CardState = {
    cardId: next.cardId,
    reps: next.reps,
    lapses: next.lapses,
    ease: next.ease,
    intervalDays: next.intervalDays,
    due: next.due,
    ...(next.lastGrade !== undefined ? { lastGrade: next.lastGrade } : {}),
    history: next.history,
  };
  return cardStatesRepo.put(stored);
}
