// §6.3/§14 — Error ring buffer plus assessment, verification, conflict, coach-message and meta repositories.
import { db } from '../db';
import {
  assessmentSchema, coachMessageSchema, dataConflictSchema, errorRecordSchema,
  metaRecordSchema, verificationRecordSchema,
  type Assessment, type CoachMessage, type DataConflict, type ErrorRecord,
  type MetaRecord, type VerificationRecord,
} from '../schemas';

export const errorsRepo = {
  /** Returns the error record with this id, or undefined. */
  async get(id: string): Promise<ErrorRecord | undefined> {
    return db.errors.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<ErrorRecord | undefined> {
    return db.errors.get(id);
  },
  /** Returns every error record, newest first (the local ring buffer, last 50 shown in Diagnostics). */
  async all(): Promise<ErrorRecord[]> {
    return db.errors.orderBy('at').reverse().toArray();
  },
  /** Returns the most recent error records, up to `limit` (default 50). */
  async latest(limit = 50): Promise<ErrorRecord[]> {
    return db.errors.orderBy('at').reverse().limit(limit).toArray();
  },
  /** Validates and upserts an error record. */
  async put(error: ErrorRecord): Promise<ErrorRecord> {
    const parsed = errorRecordSchema.parse(error);
    await db.errors.put(parsed);
    return parsed;
  },
  /** Removes the error record with this id. */
  async remove(id: string): Promise<void> {
    await db.errors.delete(id);
  },
};

export const assessmentsRepo = {
  async get(id: string): Promise<Assessment | undefined> { return db.assessments.get(id); },
  async getById(id: string): Promise<Assessment | undefined> { return db.assessments.get(id); },
  async all(): Promise<Assessment[]> { return db.assessments.orderBy('at').toArray(); },
  async put(assessment: Assessment): Promise<Assessment> {
    const parsed = assessmentSchema.parse(assessment);
    await db.assessments.put(parsed);
    return parsed;
  },
  async remove(id: string): Promise<void> { await db.assessments.delete(id); },
};

export const verificationsRepo = {
  async get(id: string): Promise<VerificationRecord | undefined> { return db.verifications.get(id); },
  async getById(id: string): Promise<VerificationRecord | undefined> { return db.verifications.get(id); },
  async all(): Promise<VerificationRecord[]> { return db.verifications.orderBy('at').toArray(); },
  async allByEntity(entityId: string): Promise<VerificationRecord[]> {
    return db.verifications.where('entityId').equals(entityId).sortBy('at');
  },
  async put(record: VerificationRecord): Promise<VerificationRecord> {
    const parsed = verificationRecordSchema.parse(record);
    await db.verifications.put(parsed);
    return parsed;
  },
  async remove(id: string): Promise<void> { await db.verifications.delete(id); },
};

export const conflictsRepo = {
  async get(id: string): Promise<DataConflict | undefined> { return db.conflicts.get(id); },
  async getById(id: string): Promise<DataConflict | undefined> { return db.conflicts.get(id); },
  async all(): Promise<DataConflict[]> { return db.conflicts.toArray(); },
  async allByEntity(entityId: string): Promise<DataConflict[]> {
    return db.conflicts.where('entityId').equals(entityId).toArray();
  },
  async allOpen(): Promise<DataConflict[]> {
    return db.conflicts.where('status').equals('open').toArray();
  },
  async put(conflict: DataConflict): Promise<DataConflict> {
    const parsed = dataConflictSchema.parse(conflict);
    await db.conflicts.put(parsed);
    return parsed;
  },
  async remove(id: string): Promise<void> { await db.conflicts.delete(id); },
};

export const coachMessagesRepo = {
  async get(id: string): Promise<CoachMessage | undefined> { return db.coachMessages.get(id); },
  async getById(id: string): Promise<CoachMessage | undefined> { return db.coachMessages.get(id); },
  async all(): Promise<CoachMessage[]> { return db.coachMessages.orderBy('at').toArray(); },
  async allByThread(threadId: string): Promise<CoachMessage[]> {
    return db.coachMessages.where('threadId').equals(threadId).sortBy('at');
  },
  async put(message: CoachMessage): Promise<CoachMessage> {
    const parsed = coachMessageSchema.parse(message);
    await db.coachMessages.put(parsed);
    return parsed;
  },
  async remove(id: string): Promise<void> { await db.coachMessages.delete(id); },
};

export const metaRepo = {
  async get(key: string): Promise<MetaRecord | undefined> { return db.meta.get(key); },
  async getById(key: string): Promise<MetaRecord | undefined> { return db.meta.get(key); },
  async all(): Promise<MetaRecord[]> { return db.meta.toArray(); },
  async put(record: MetaRecord): Promise<MetaRecord> {
    const parsed = metaRecordSchema.parse(record);
    await db.meta.put(parsed);
    return parsed;
  },
  async remove(key: string): Promise<void> { await db.meta.delete(key); },
};
