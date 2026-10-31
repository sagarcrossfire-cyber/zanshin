// Release 1.3.0 — research notes repository: web-sourced answers, matchup
// primers and patch briefs Sagar kept from the intel function. Like every
// repository, the only code that touches the `research` table.
import { db } from '../db';
import { researchNoteSchema, type ResearchKind, type ResearchNote } from '../schemas';

export const researchRepo = {
  /** Every note, newest first. */
  async all(): Promise<ResearchNote[]> {
    return db.research.orderBy('createdAt').reverse().toArray();
  },
  async get(id: string): Promise<ResearchNote | undefined> {
    return db.research.get(id);
  },
  /** Notes of one kind, newest first. */
  async byKind(kind: ResearchKind): Promise<ResearchNote[]> {
    const rows = await db.research.where('kind').equals(kind).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  /** Notes about one subject (character:<Name>, patch:<revision>), newest first. */
  async bySubject(subjectKey: string): Promise<ResearchNote[]> {
    const rows = await db.research.where('subjectKey').equals(subjectKey).toArray();
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  /** The newest note of one kind about one subject, or undefined. */
  async latest(kind: ResearchKind, subjectKey: string): Promise<ResearchNote | undefined> {
    const rows = await this.bySubject(subjectKey);
    return rows.find((row) => row.kind === kind);
  },
  async put(note: ResearchNote): Promise<ResearchNote> {
    const parsed = researchNoteSchema.parse(note);
    await db.research.put(parsed);
    return parsed;
  },
  async remove(id: string): Promise<void> {
    await db.research.delete(id);
  },
  async count(): Promise<number> {
    return db.research.count();
  },
};
