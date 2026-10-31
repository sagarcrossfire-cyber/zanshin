// Matchups — spec §5.11/§9.1. Problem moves create and link one Lab drill
// (resolvable as `problem:<id>` — see domain/lab/blocks.ts) and one
// flashcard. Character packs import on demand via the Wavu importer and
// are cached in the packs table.
import { importMoves, type FetchLike } from '../data/import/wavu';
import { cardsRepo, packsRepo, problemMovesRepo } from '../data/repos';
import type { ProblemMove } from '../data/schemas';
import { DATA_PATCH } from '../data/packs';

export const CHARACTER_PACK_PREFIX = 'moves-';

export function characterPackId(character: string): string {
  return `${CHARACTER_PACK_PREFIX}${character}`;
}

/** Import a character's movelist on demand (§9.1), caching the result. Returns the move count. */
export async function importCharacterPack(
  fetcher: FetchLike,
  character: string,
  patch = DATA_PATCH,
): Promise<number> {
  const existing = await packsRepo.get(characterPackId(character));
  if (existing && existing.patch === patch) {
    return (existing.data as unknown[]).length;
  }
  const moves = await importMoves(fetcher, { character, patch });
  await packsRepo.put({
    id: characterPackId(character),
    kind: 'moves',
    patch,
    version: `1.0.0-${patch}`,
    updatedAt: new Date().toISOString(),
    data: moves,
    provenance: { patch, status: 'sourced', source: 'wavu' },
  });
  return moves.length;
}

export type AnswerKind = ProblemMove['answer']['kind'];

/**
 * Create a problem move and link one Lab drill + one flashcard (AC-MU-1).
 * The drill kind follows the answer: 'punish' answers become punish drills,
 * everything else becomes a reaction drill.
 */
export async function createProblemMove(args: {
  character: string;
  moveId?: string;
  input: string;
  description: string;
  answerKind: AnswerKind;
  answerDetail: string;
  punisherMoveId?: string;
  verified?: boolean;
  createdFrom: ProblemMove['createdFrom'];
  nowIso: string;
}): Promise<ProblemMove> {
  const id = `pm-${Date.parse(args.nowIso)}-${Math.floor(Math.random() * 1_000_000)}`;
  const drillId = `problem:${id}`;
  const cardId = `card-${id}`;
  await cardsRepo.put({
    id: cardId,
    deck: args.character,
    front: `${args.character} ${args.input}: what do you do?`,
    back: args.answerDetail,
    refs: args.moveId ? [args.moveId] : [],
    createdAt: args.nowIso,
  });
  const problemMove: ProblemMove = {
    id,
    character: args.character,
    ...(args.moveId ? { moveId: args.moveId } : {}),
    input: args.input,
    description: args.description,
    answer: {
      kind: args.answerKind,
      detail: args.answerDetail,
      ...(args.punisherMoveId ? { punisherMoveId: args.punisherMoveId } : {}),
    },
    verified: args.verified ?? false,
    drillId,
    cardId,
    createdFrom: args.createdFrom,
  };
  await problemMovesRepo.put(problemMove);
  return problemMove;
}

/** Drill-type label for a problem move's generated drill (punish vs reaction). */
export { problemDrillKind } from '../domain/lab/blocks';
