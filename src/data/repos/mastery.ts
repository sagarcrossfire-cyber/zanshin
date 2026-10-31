// §6.3/§7.1/§7.2 — Mastery and stage-status repositories (mastery, stageStatus tables).
import { db } from '../db';
import { masterySchema, stageStatusSchema, type Mastery, type StageStatus } from '../schemas';

export const masteryRepo = {
  /** Returns the mastery row for one node, or undefined. Keyed by nodeId. */
  async get(nodeId: string): Promise<Mastery | undefined> {
    return db.mastery.get(nodeId);
  },
  /** Alias for get(nodeId). */
  async getById(nodeId: string): Promise<Mastery | undefined> {
    return db.mastery.get(nodeId);
  },
  /** Returns every mastery row. */
  async all(): Promise<Mastery[]> {
    return db.mastery.toArray();
  },
  /** Returns the mastery rows in one state (locked, solid, rusty, ...). */
  async allByState(state: Mastery['state']): Promise<Mastery[]> {
    return db.mastery.where('state').equals(state).toArray();
  },
  /** Validates and upserts a mastery row (engine state is recomputable from history). */
  async put(mastery: Mastery): Promise<Mastery> {
    const parsed = masterySchema.parse(mastery);
    await db.mastery.put(parsed);
    return parsed;
  },
  /** Removes the mastery row for one node. */
  async remove(nodeId: string): Promise<void> {
    await db.mastery.delete(nodeId);
  },
};

export const stageStatusRepo = {
  /** Returns the status row for one stage, or undefined. Keyed by stageId. */
  async get(stageId: string): Promise<StageStatus | undefined> {
    return db.stageStatus.get(stageId);
  },
  /** Alias for get(stageId). */
  async getById(stageId: string): Promise<StageStatus | undefined> {
    return db.stageStatus.get(stageId);
  },
  /** Returns every stage-status row. */
  async all(): Promise<StageStatus[]> {
    return db.stageStatus.toArray();
  },
  /** Returns the stage-status rows in one state (locked, open, passed). */
  async allByState(state: StageStatus['state']): Promise<StageStatus[]> {
    return db.stageStatus.where('state').equals(state).toArray();
  },
  /** Validates and upserts a stage-status row. */
  async put(status: StageStatus): Promise<StageStatus> {
    const parsed = stageStatusSchema.parse(status);
    await db.stageStatus.put(parsed);
    return parsed;
  },
  /** Removes the status row for one stage. */
  async remove(stageId: string): Promise<void> {
    await db.stageStatus.delete(stageId);
  },
};
