// §6.3/§6.4 — Flashcard and card-state repositories (cards, cardStates tables).
import { db } from '../db';
import { cardSchema, cardStateSchema, type Card, type CardState } from '../schemas';

export const cardsRepo = {
  /** Returns the card with this id, or undefined. */
  async get(id: string): Promise<Card | undefined> {
    return db.cards.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<Card | undefined> {
    return db.cards.get(id);
  },
  /** Returns every card, oldest first. */
  async all(): Promise<Card[]> {
    return db.cards.orderBy('createdAt').toArray();
  },
  /** Returns the cards in one deck, oldest first. */
  async allByDeck(deck: string): Promise<Card[]> {
    return db.cards.where('deck').equals(deck).sortBy('createdAt');
  },
  /** Validates and upserts a card. */
  async put(card: Card): Promise<Card> {
    const parsed = cardSchema.parse(card);
    await db.cards.put(parsed);
    return parsed;
  },
  /** Removes the card with this id. Its card state is kept (see cardStatesRepo). */
  async remove(id: string): Promise<void> {
    await db.cards.delete(id);
  },
};

export const cardStatesRepo = {
  /** Returns the schedule state for one card, or undefined. Keyed by cardId. */
  async get(cardId: string): Promise<CardState | undefined> {
    return db.cardStates.get(cardId);
  },
  /** Alias for get(cardId). */
  async getById(cardId: string): Promise<CardState | undefined> {
    return db.cardStates.get(cardId);
  },
  /** Returns every card state. */
  async all(): Promise<CardState[]> {
    return db.cardStates.toArray();
  },
  /** Returns the card states due on or before one practice day. */
  async allDue(dueOnOrBefore: string): Promise<CardState[]> {
    return db.cardStates.where('due').belowOrEqual(dueOnOrBefore).toArray();
  },
  /** Validates and upserts a card state. */
  async put(state: CardState): Promise<CardState> {
    const parsed = cardStateSchema.parse(state);
    await db.cardStates.put(parsed);
    return parsed;
  },
  /** Removes the schedule state for one card. */
  async remove(cardId: string): Promise<void> {
    await db.cardStates.delete(cardId);
  },
};
