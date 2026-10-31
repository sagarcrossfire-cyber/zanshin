// §6.3/§6.4 — Session repository (sessions table, with their blocks embedded).
import { db } from '../db';
import { sessionSchema, type Session } from '../schemas';

export const sessionsRepo = {
  /** Returns the session with this id, or undefined. */
  async get(id: string): Promise<Session | undefined> {
    return db.sessions.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<Session | undefined> {
    return db.sessions.get(id);
  },
  /** Returns every session, newest first. */
  async all(): Promise<Session[]> {
    return db.sessions.orderBy('startedAt').reverse().toArray();
  },
  /** Returns sessions with the given status, newest first. */
  async allByStatus(status: Session['status']): Promise<Session[]> {
    return db.sessions.where('status').equals(status).reverse().sortBy('startedAt');
  },
  /** Validates and upserts a session (blocks are stored on the session row). */
  async put(session: Session): Promise<Session> {
    const parsed = sessionSchema.parse(session);
    await db.sessions.put(parsed);
    return parsed;
  },
  /** Removes the session with this id. Its drill sets are kept (see sets repo). */
  async remove(id: string): Promise<void> {
    await db.sessions.delete(id);
  },
};
