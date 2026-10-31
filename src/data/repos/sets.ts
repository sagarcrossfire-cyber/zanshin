// §6.3/§6.4 — Drill-set repository (sets table: sessionId, drillId, nodeId, day).
import { db } from '../db';
import { drillSetSchema, type DrillSet } from '../schemas';

export const setsRepo = {
  /** Returns the drill set with this id, or undefined. */
  async get(id: string): Promise<DrillSet | undefined> {
    return db.sets.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<DrillSet | undefined> {
    return db.sets.get(id);
  },
  /** Returns every drill set, oldest first. */
  async all(): Promise<DrillSet[]> {
    return db.sets.orderBy('at').toArray();
  },
  /** Returns the sets logged inside one session, in logged order. */
  async allBySession(sessionId: string): Promise<DrillSet[]> {
    return db.sets.where('sessionId').equals(sessionId).sortBy('at');
  },
  /** Returns the sets for one drill, oldest first. */
  async allByDrill(drillId: string): Promise<DrillSet[]> {
    return db.sets.where('drillId').equals(drillId).sortBy('at');
  },
  /** Returns the sets for one node, oldest first. */
  async allByNode(nodeId: string): Promise<DrillSet[]> {
    return db.sets.where('nodeId').equals(nodeId).sortBy('at');
  },
  /** Returns the sets logged on one practice day (ISODate, after the day boundary). */
  async allByDay(day: string): Promise<DrillSet[]> {
    return db.sets.where('day').equals(day).sortBy('at');
  },
  /** Validates and upserts a drill set. */
  async put(set: DrillSet): Promise<DrillSet> {
    const parsed = drillSetSchema.parse(set);
    await db.sets.put(parsed);
    return parsed;
  },
  /** Removes the drill set with this id. */
  async remove(id: string): Promise<void> {
    await db.sets.delete(id);
  },
};
