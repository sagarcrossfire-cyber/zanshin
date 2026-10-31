// §6.3/§6.4 — Problem-move and move-note repositories (problemMoves, moveNotes tables).
import { db } from '../db';
import { moveNoteSchema, problemMoveSchema, type MoveNote, type ProblemMove } from '../schemas';

export const problemMovesRepo = {
  /** Returns the problem move with this id, or undefined. */
  async get(id: string): Promise<ProblemMove | undefined> {
    return db.problemMoves.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<ProblemMove | undefined> {
    return db.problemMoves.get(id);
  },
  /** Returns every problem move. */
  async all(): Promise<ProblemMove[]> {
    return db.problemMoves.toArray();
  },
  /** Returns the problem moves for one character. */
  async allByCharacter(character: string): Promise<ProblemMove[]> {
    return db.problemMoves.where('character').equals(character).toArray();
  },
  /** Validates and upserts a problem move. */
  async put(problemMove: ProblemMove): Promise<ProblemMove> {
    const parsed = problemMoveSchema.parse(problemMove);
    await db.problemMoves.put(parsed);
    return parsed;
  },
  /** Removes the problem move with this id. */
  async remove(id: string): Promise<void> {
    await db.problemMoves.delete(id);
  },
};

export const moveNotesRepo = {
  /** Returns the note for one move, or undefined. Keyed by moveId. */
  async get(moveId: string): Promise<MoveNote | undefined> {
    return db.moveNotes.get(moveId);
  },
  /** Alias for get(moveId). */
  async getById(moveId: string): Promise<MoveNote | undefined> {
    return db.moveNotes.get(moveId);
  },
  /** Returns every move note. */
  async all(): Promise<MoveNote[]> {
    return db.moveNotes.toArray();
  },
  /** Returns the notes for one character. */
  async allByCharacter(character: string): Promise<MoveNote[]> {
    return db.moveNotes.where('character').equals(character).toArray();
  },
  /** Validates and upserts a move note (one note per move). */
  async put(note: MoveNote): Promise<MoveNote> {
    const parsed = moveNoteSchema.parse(note);
    await db.moveNotes.put(parsed);
    return parsed;
  },
  /** Removes the note for one move. */
  async remove(moveId: string): Promise<void> {
    await db.moveNotes.delete(moveId);
  },
};
