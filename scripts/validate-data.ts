// §13.6 — Data validation: `npm run validate:data`. Schema-validates every pack, tokenizes
// every input and combo segment with the real tokenizer (§10.1), resolves every
// reference, rejects duplicate ids, applies the frame-sanity regexes, checks
// provenance, and prints counts. Exits non-zero on any error.
import {
  loadAllPacks, DATA_PATCH,
} from '../src/data/packs/index';
import { parseBlockMin, parseFirstFrameValue } from '../src/data/import/parse';
import { tokenizeWithUnknowns } from '../src/domain/notation/tokenize';
import type { Move } from '../src/data/schemas';

const errors: string[] = [];
function fail(message: string): void {
  errors.push(message);
}

function checkInput(label: string, input: string): void {
  const { unknowns } = tokenizeWithUnknowns(input);
  for (const unknown of unknowns) {
    fail(`${label}: unknown token ${JSON.stringify(unknown)} in ${JSON.stringify(input)}`);
  }
}

const STARTUP_RE = /^,?i\d+(~\d+)?( i\d+(~\d+)?)*$/;
const DAMAGE_RE = /^[0-9,;()+\sA-Za-z[\]-]*$/;

// §13.6 curation scopes Role text to the §10.6 core-moves table only — the
// live Wavu pack has 300+ moves with no curated Role, and requiring notes on
// every move would reject valid sourced data. §10.6 inputs (b+3/b+4 and
// 1+3/2+4 are separate rows in the pack).
const SECTION_10_6_INPUTS = new Set([
  '1', '1,1', '2,2', '4', 'df+4', 'df+1', 'df+1,4', 'df+1,2', 'b+2,2', 'b+2,1',
  'df+2', 'uf+3', '3,1', '3,2,1+2', '3~4', 'f+1+2', 'f,f,F+3', 'f,n,d,df+2',
  'f,n,d,df+1', 'SS.1', 'hFC.df+4', 'db+4', 'd+2,2,2', 'uf+4', 'f,F+4', 'b+1',
  '1+4', 'b+3', 'b+4', 'FC.DF+1', 'f+4', 'ub+1+2', 'd+1', 'ws4', 'ws1,2',
  'ws2,1', '1+3', '2+4', '2+3', 'R.df+1+2',
]);

function checkDuplicates<T>(label: string, ids: T[]): void {
  const seen = new Set<T>();
  for (const id of ids) {
    if (seen.has(id)) fail(`Duplicate ${label} id: ${String(id)}`);
    seen.add(id);
  }
}

function main(): void {
  let packs;
  try {
    packs = loadAllPacks();
  } catch (error) {
    fail(`Pack schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
    printAndExit(0, 0, 0, 0, 0, 0, 0, 0);
    return;
  }
  const { moves, punishers, stances, combos, curriculum, roster, conflicts, cardTemplates, playbook } = packs;
  const moveById = new Map(moves.map((m) => [m.id, m]));
  const moveIds = new Set(moveById.keys());
  const drillIds = new Set(curriculum.drills.map((d) => d.id));

  // --- Playbook: every item links to a real move and a real drill (AC-PB-1). ---
  for (const item of [...playbook.counterplay, ...playbook.plans]) {
    const linkedMoves = [...(item.moveIds ?? []), ...(item.coreMoveIds ?? [])];
    if (linkedMoves.length === 0) fail(`Playbook item ${item.id} links to no move (AC-PB-1)`);
    for (const moveId of linkedMoves) {
      if (!moveIds.has(moveId)) fail(`Playbook item ${item.id} references missing move ${moveId}`);
    }
    if (item.drillIds.length === 0) fail(`Playbook item ${item.id} links to no drill (AC-PB-1)`);
    for (const drillId of item.drillIds) {
      if (!drillIds.has(drillId)) fail(`Playbook item ${item.id} references missing drill ${drillId}`);
    }
  }

  // --- Moves: schema (via loader), notation, frame sanity, provenance, Role text (§13.6). ---
  checkDuplicates('move', moves.map((m) => m.id));
  let stringCount = 0;
  for (const move of moves) {
    if (move.parentId !== undefined) {
      stringCount += 1;
      if (!moveIds.has(move.parentId)) fail(`Move ${move.id} has missing parent ${move.parentId}`);
    }
    checkInput(`Move ${move.id} input`, move.input);
    if (move.startup !== '' && !STARTUP_RE.test(move.startup)) {
      fail(`Move ${move.id} startup fails frame-sanity regex: ${JSON.stringify(move.startup)}`);
    }
    if (move.blockMin !== undefined && (move.blockMin < -100 || move.blockMin > 30)) {
      fail(`Move ${move.id} blockMin ${move.blockMin} outside [-100, 30]`);
    }
    if (move.hit !== undefined && move.hit !== '') {
      const parsed = parseFirstFrameValue(move.hit);
      if (parsed !== undefined && (parsed.value < -100 || parsed.value > 80)) {
        fail(`Move ${move.id} hit value ${parsed.value} outside [-100, 80]`);
      }
    }
    if (move.block !== undefined && move.block !== '') {
      try {
        const blockMin = parseBlockMin(move.block);
        if (move.blockMin !== undefined && blockMin !== undefined && blockMin !== move.blockMin) {
          fail(`Move ${move.id} blockMin ${move.blockMin} does not match block ${JSON.stringify(move.block)} (worst case ${blockMin})`);
        }
      } catch (error) {
        fail(`Move ${move.id} block unparseable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (move.damage !== '' && (!DAMAGE_RE.test(move.damage) || !/\d/.test(move.damage))) {
      fail(`Move ${move.id} damage does not parse: ${JSON.stringify(move.damage)}`);
    }
    if (move.provenance.patch === '' || move.provenance.status === undefined) {
      fail(`Move ${move.id} is missing provenance`);
    }
    if (move.provenance.patch !== DATA_PATCH) {
      fail(`Move ${move.id} provenance patch ${move.provenance.patch} is not ${DATA_PATCH}`);
    }
    if (SECTION_10_6_INPUTS.has(move.input) && (move.notes === undefined || move.notes.trim() === '')) {
      fail(`Move ${move.id} is missing its Role/curation notes (§13.6 curation, §10.6)`);
    }
  }

  // --- Punishers: duplicates, move references, provenance. ---
  checkDuplicates('punisher', punishers.map((p) => `${p.posture}:${p.enemy}`));
  if (punishers.length !== 18) fail(`Expected 18 punishers (9 enemy values x 2 postures), got ${punishers.length}`);
  for (const punisher of punishers) {
    if (!moveIds.has(punisher.moveId)) {
      fail(`Punisher ${punisher.posture} ${punisher.enemy} points to missing move ${punisher.moveId}`);
    } else {
      const move = moveById.get(punisher.moveId) as Move;
      if (move.input !== punisher.input) {
        fail(`Punisher ${punisher.posture} ${punisher.enemy} input ${JSON.stringify(punisher.input)} does not match move ${punisher.moveId} input ${JSON.stringify(move.input)}`);
      }
    }
    if (punisher.provenance.patch === '') fail(`Punisher ${punisher.posture} ${punisher.enemy} is missing provenance`);
  }

  // --- Stances: duplicates, fastest move references. ---
  checkDuplicates('stance', stances.map((s) => s.id));
  for (const stance of stances) {
    for (const option of stance.fastest) {
      if (option.moveId !== undefined && !moveIds.has(option.moveId)) {
        fail(`Stance ${stance.id} fastest option points to missing move ${option.moveId}`);
      }
    }
    if (stance.provenance.patch === '') fail(`Stance ${stance.id} is missing provenance`);
  }

  // --- Combos: duplicates, segment tokenization, starter tokenization. ---
  checkDuplicates('combo', combos.map((c) => c.id));
  const STARTER_PROSE = new Set(['low', 'parry', 'after', 'a', 'splat', 'counter-hit']);
  for (const combo of combos) {
    if (combo.segments.length === 0) fail(`Combo ${combo.id} has no segments`);
    for (const segment of combo.segments) checkInput(`Combo ${combo.id} segment`, segment);
    for (const starter of combo.starters) {
      // Starters may be prose ('low parry', 'after a splat'); only the
      // notation-looking words are tokenized, prose words are allowlisted.
      const notationPart = starter.split(/\s+/).filter((t) => t !== '' && !STARTER_PROSE.has(t)).join(' ');
      if (notationPart !== '') checkInput(`Combo ${combo.id} starter`, notationPart);
    }
    if (combo.provenance.patch === '') fail(`Combo ${combo.id} is missing provenance`);
  }

  // --- Curriculum: stages = 10, nodes, drills, references, prerequisite cycles. ---
  const { stages, nodes, drills } = curriculum;
  if (stages.length !== 10) fail(`Expected 10 stages, got ${stages.length}`);
  checkDuplicates('stage', stages.map((s) => s.id));
  checkDuplicates('node', nodes.map((n) => n.id));
  checkDuplicates('drill', drills.map((d) => d.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const drillById = new Map(drills.map((d) => [d.id, d]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  for (const stage of stages) {
    for (const nodeId of stage.nodeIds) {
      const node = nodeById.get(nodeId);
      if (node === undefined) fail(`Stage ${stage.id} lists missing node ${nodeId}`);
      else if (node.stageId !== stage.id) fail(`Node ${nodeId} belongs to ${node.stageId} but is listed in ${stage.id}`);
    }
    for (const criterion of stage.gate.criteria) {
      if (criterion.window.n <= 0) fail(`Stage ${stage.id} gate criterion has a non-positive window`);
    }
  }
  for (const node of nodes) {
    if (!stageById.has(node.stageId)) fail(`Node ${node.id} points to missing stage ${node.stageId}`);
    for (const prereq of node.prerequisites) {
      if (!nodeById.has(prereq)) fail(`Node ${node.id} has missing prerequisite ${prereq}`);
    }
    for (const drillId of node.drillIds) {
      if (!drillById.has(drillId)) fail(`Node ${node.id} lists missing drill ${drillId}`);
    }
    for (const ref of node.codexRefs) {
      if (!moveIds.has(ref)) fail(`Node ${node.id} codexRef points to missing move ${ref}`);
    }
  }
  // Prerequisite cycle detection (DFS over the prerequisite graph).
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visitNode = (nodeId: string, path: string[]): void => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      fail(`Prerequisite cycle: ${[...path, nodeId].join(' -> ')}`);
      return;
    }
    visiting.add(nodeId);
    const node = nodeById.get(nodeId);
    if (node !== undefined) {
      for (const prereq of node.prerequisites) visitNode(prereq, [...path, nodeId]);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visitNode(node.id, []);
  for (const drill of drills) {
    if (!nodeById.has(drill.nodeId)) fail(`Drill ${drill.id} points to missing node ${drill.nodeId}`);
    for (const ref of drill.codexRefs) {
      if (!moveIds.has(ref)) fail(`Drill ${drill.id} codexRef points to missing move ${ref}`);
    }
    if (drill.recipe.length === 0 || drill.steps.length === 0) fail(`Drill ${drill.id} has an empty recipe or steps`);
  }

  // --- Roster: 42 characters. ---
  if (roster.length !== 42) fail(`Expected 42 roster characters, got ${roster.length}`);
  checkDuplicates('roster character', roster.map((c) => c.name));

  // --- Conflicts: every conflict points to an existing entity (move, character or stage). ---
  checkDuplicates('conflict', conflicts.map((c) => c.id));
  const entityIds = new Set<string>([
    ...moveIds,
    ...roster.map((c) => c.name),
    ...stages.map((s) => s.id),
  ]);
  for (const conflict of conflicts) {
    if (!entityIds.has(conflict.entityId)) {
      fail(`Conflict ${conflict.id} points to missing entity ${conflict.entityId}`);
    }
    if (conflict.values.length < 2) fail(`Conflict ${conflict.id} has fewer than 2 values`);
  }

  // --- Card templates: decks exist, fields exist on their source record type. ---
  const deckNames = new Set(cardTemplates.decks.map((d) => d.name));
  const TEMPLATE_FIELDS: Record<string, Set<string>> = {
    moves: new Set(['input', 'name', 'aliases', 'hitLevel', 'damage', 'startup', 'block', 'hit', 'counterHit', 'stance', 'notes', 'spoken', 'tier']),
    punishers: new Set(['enemy', 'posture', 'input', 'damage', 'comboDamage', 'onHit', 'onBlock', 'moveId']),
    stances: new Set(['name', 'entries', 'fastest', 'uses', 'risks', 'counterplay']),
    static: new Set<string>(),
  };
  checkDuplicates('card template', cardTemplates.templates.map((t) => t.id));
  for (const template of cardTemplates.templates) {
    if (!deckNames.has(template.deck)) fail(`Card template ${template.id} points to missing deck ${template.deck}`);
    const allowed = TEMPLATE_FIELDS[template.source];
    if (allowed === undefined) fail(`Card template ${template.id} has unknown source ${template.source}`);
    for (const field of template.fields) {
      if (allowed !== undefined && !allowed.has(field)) {
        fail(`Card template ${template.id} references unknown field ${field} for source ${template.source}`);
      }
    }
  }

  printAndExit(moves.length, stringCount, punishers.length, combos.length, stages.length, nodes.length, drills.length, cardTemplates.templates.length);
}

function printAndExit(
  moves: number, strings: number, punishers: number, combos: number,
  stages: number, nodes: number, drills: number, cardTemplates: number,
): void {
  console.log(
    `moves=${moves} strings=${strings} punishers=${punishers} combos=${combos} ` +
    `stages=${stages} nodes=${nodes} drills=${drills} cardTemplates=${cardTemplates}`,
  );
  if (errors.length > 0) {
    console.error(`validate:data FAILED with ${errors.length} error(s):`);
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log('validate:data OK');
  }
}

main();
