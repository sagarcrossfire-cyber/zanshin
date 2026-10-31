// Block resolution — spec §5.5/§5.8. A session block resolves to one of:
// a curriculum drill, a combo segment / full-route drill (P4 ids), or a
// verify task backed by an open DataConflict. Nothing here touches storage.
import type { Combo, CurriculumPack, DataConflict, Drill, ProblemMove } from '../../data/schemas';
import { fullRouteDrillId, segmentDrillId } from '../codex/combo';

/** Drill-type label for a problem move's generated drill (punish vs reaction). */
export function problemDrillKind(answerKind: ProblemMove['answer']['kind']): 'punish' | 'reaction' {
  return answerKind === 'punish' ? 'punish' : 'reaction';
}

export type ResolvedBlock =
  | { kind: 'drill'; title: string; why: string; recipe: string; steps: string[]; target: string; nodeId: string; drillId: string; repsPerSet: number }
  | { kind: 'verify'; conflict: DataConflict; question: string; nodeId: string; drillId: string }
  | { kind: 'note'; title: string; nodeId: string; drillId: string };

export function resolveBlock(
  drillId: string | undefined,
  curriculum: CurriculumPack,
  combos: Combo[],
  conflicts: DataConflict[],
  problemMoves: ProblemMove[] = [],
): ResolvedBlock | null {
  if (!drillId) return null;
  if (drillId.startsWith('problem:')) {
    const problemMove = problemMoves.find((pm) => pm.id === drillId.slice('problem:'.length));
    if (!problemMove) return null;
    const kind = problemDrillKind(problemMove.answer.kind);
    return {
      kind: 'drill',
      title: `${problemMove.character} ${problemMove.input} — ${kind} drill`,
      why: problemMove.description,
      recipe: `Record the dummy doing ${problemMove.input}; apply the answer: ${problemMove.answer.detail}.`,
      steps: [`Record ${problemMove.input}`, `Apply: ${problemMove.answer.detail}`],
      target: 'Apply the answer 8/10 times',
      nodeId: `problem:${problemMove.id}`,
      drillId,
      repsPerSet: 10,
    };
  }
  if (drillId.startsWith('verify:')) {
    const conflict = conflicts.find((c) => c.id === drillId.slice('verify:'.length) && c.status === 'open');
    if (!conflict) return null;
    const values = conflict.values.map((v) => `${v.source} says ${v.value}`).join('; ');
    return {
      kind: 'verify',
      conflict,
      question: `Check ${conflict.entityId} (${conflict.field}) in Practice: ${values}. Which value is right?`,
      nodeId: 'verify',
      drillId,
    };
  }
  if (drillId.startsWith('combo-seg:') || drillId.startsWith('combo-full:')) {
    const isFull = drillId.startsWith('combo-full:');
    const comboId = drillId.slice(isFull ? 'combo-full:'.length : 'combo-seg:'.length).split(':')[0] ?? '';
    const combo = combos.find((c) => c.id === comboId);
    if (!combo) return null;
    if (isFull) {
      return {
        kind: 'drill',
        title: `Full route: ${combo.name}`,
        why: 'Put the segments together.',
        recipe: combo.route,
        steps: combo.segments,
        target: 'Complete the full route',
        nodeId: `combo:${combo.id}`,
        drillId,
        repsPerSet: 10,
      };
    }
    const index = Number(drillId.split(':').at(-1));
    const segment = combo.segments[index];
    if (segment === undefined) return null;
    return {
      kind: 'drill',
      title: `Segment ${index + 1}: ${combo.name}`,
      why: 'Practice one segment alone.',
      recipe: segment,
      steps: [segment],
      target: 'Complete the segment',
      nodeId: `combo:${combo.id}`,
      drillId,
      repsPerSet: 10,
    };
  }
  const drill: Drill | undefined = curriculum.drills.find((d) => d.id === drillId);
  if (!drill) return null;
  const node = curriculum.nodes.find((n) => n.id === drill.nodeId);
  return {
    kind: 'drill',
    title: drill.title,
    why: node?.why ?? '',
    recipe: drill.recipe.join(' '),
    steps: drill.steps,
    target: `${Math.round(drill.target.successRate * 100)}% over ${drill.target.sets} sets`,
    nodeId: drill.nodeId,
    drillId: drill.id,
    repsPerSet: drill.repsPerSet,
  };
}

export function comboSegmentDrillIds(comboId: string, segmentCount: number): string[] {
  return Array.from({ length: segmentCount }, (_, i) => segmentDrillId(comboId, i));
}

export function comboFullDrillId(comboId: string): string {
  return fullRouteDrillId(comboId);
}
