// §6.3/§6.4 — Match-set and replay-review repositories (matchSets, reviews tables).
import { db } from '../db';
import { matchSetSchema, replayReviewSchema, type MatchSet, type ReplayReview } from '../schemas';

export const matchSetsRepo = {
  /** Returns the match set with this id, or undefined. */
  async get(id: string): Promise<MatchSet | undefined> {
    return db.matchSets.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<MatchSet | undefined> {
    return db.matchSets.get(id);
  },
  /** Returns every match set, oldest first. */
  async all(): Promise<MatchSet[]> {
    return db.matchSets.orderBy('at').toArray();
  },
  /** Returns the match sets logged on one practice day, oldest first. */
  async allByDay(day: string): Promise<MatchSet[]> {
    return db.matchSets.where('day').equals(day).sortBy('at');
  },
  /** Returns the match sets against one character, oldest first. */
  async allByCharacter(opponentCharacter: string): Promise<MatchSet[]> {
    return db.matchSets.where('opponentCharacter').equals(opponentCharacter).sortBy('at');
  },
  /** Validates and upserts a match set. */
  async put(matchSet: MatchSet): Promise<MatchSet> {
    const parsed = matchSetSchema.parse(matchSet);
    await db.matchSets.put(parsed);
    return parsed;
  },
  /** Removes the match set with this id. Its replay reviews are kept. */
  async remove(id: string): Promise<void> {
    await db.matchSets.delete(id);
  },
};

export const reviewsRepo = {
  /** Returns the replay review with this id, or undefined. */
  async get(id: string): Promise<ReplayReview | undefined> {
    return db.reviews.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<ReplayReview | undefined> {
    return db.reviews.get(id);
  },
  /** Returns the reviews for one match set, oldest first. */
  async allByMatchSet(matchSetId: string): Promise<ReplayReview[]> {
    return db.reviews.where('matchSetId').equals(matchSetId).sortBy('at');
  },
  /** Returns every replay review, oldest first. */
  async all(): Promise<ReplayReview[]> {
    return db.reviews.orderBy('at').toArray();
  },
  /** Validates and upserts a replay review. */
  async put(review: ReplayReview): Promise<ReplayReview> {
    const parsed = replayReviewSchema.parse(review);
    await db.reviews.put(parsed);
    return parsed;
  },
  /** Removes the replay review with this id. */
  async remove(id: string): Promise<void> {
    await db.reviews.delete(id);
  },
};
