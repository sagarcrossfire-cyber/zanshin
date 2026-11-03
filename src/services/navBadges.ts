// 2.0 navigation badges (design.md §B.1): Train shows how many flashcards
// the review screen would actually serve today — the same daily-cap
// partitioning Flashcards review uses (m9), not the raw due count, so day
// one never shows more than the caps allow (e.g. "99+" for 111 due when
// review serves at most 10 new + 60 reviews). Read through the
// repositories; screens and components never touch IndexedDB.
import { cardsRepo, cardStatesRepo } from '../data/repos/cards';
import { reviewCaps, reviewQueue } from './cards';
import { todayIso } from '../app/plan';
import type { Settings } from '../data/schemas';

export interface NavBadges {
  dueCards: number;
}

export async function loadNavBadges(
  settings?: Pick<Settings, 'newCardsPerDay' | 'reviewsPerDay'> | null,
): Promise<NavBadges> {
  try {
    const [cards, states] = await Promise.all([cardsRepo.all(), cardStatesRepo.all()]);
    const queue = reviewQueue(cards, states, todayIso(), reviewCaps(settings));
    return { dueCards: queue.newCards.length + queue.reviewCards.length };
  } catch {
    return { dueCards: 0 };
  }
}
