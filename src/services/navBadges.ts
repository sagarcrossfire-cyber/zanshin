// 2.0 navigation badges (design.md §B.1): Train shows how many flashcards
// are due today. Read through the repositories; screens and components never
// touch IndexedDB.
import { cardStatesRepo } from '../data/repos/cards';
import { dueCount } from '../domain/engine/srs';
import { todayIso } from '../app/plan';

export interface NavBadges {
  dueCards: number;
}

export async function loadNavBadges(): Promise<NavBadges> {
  try {
    const states = await cardStatesRepo.all();
    return { dueCards: dueCount(states, todayIso()) };
  } catch {
    return { dueCards: 0 };
  }
}
