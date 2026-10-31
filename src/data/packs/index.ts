// §10/§11 — Typed loaders for the bundled seed packs. Every loader validates with its Zod schema before returning.
import {
  cardTemplatesPackSchema, characterSchema, comboSchema, curriculumPackSchema,
  dataConflictSchema, moveSchema, punisherSchema, stanceSchema,
  type CardTemplatesPack, type Character, type Combo, type CurriculumPack,
  type DataConflict, type Move, type Punisher, type Stance,
} from '../schemas';
import cardTemplatesJson from './card-templates.json';
import combosJson from './combos.json';
import conflictsJson from './conflicts.json';
import curriculumJson from './curriculum.json';
import movesYoshimitsuJson1 from './moves.yoshimitsu.1.json';
import movesYoshimitsuJson2 from './moves.yoshimitsu.2.json';
import movesYoshimitsuJson3 from './moves.yoshimitsu.3.json';
import playbookJson from './playbook.json';
import punishersJson from './punishers.json';
import rosterJson from './roster.json';
import stancesJson from './stances.json';
import { z } from 'zod';

/** Patch label carried by every record (§10: frame values fetched 2026-10-29, patch 3.02.02; live Wavu revision 62125). */
export const DATA_PATCH = '3.02.02';
/** Provenance source of the bundled moves pack: live Wavu import merged with seed curation (see D-008). Other packs remain seed. */
export const DATA_SOURCE = 'wavu+seed';
/** Version of the bundled packs. */
export const PACK_VERSION = '1.0.0-wavu-62125';

/** Every Yoshimitsu move in the seed pack (§10.6 plus the stance/Heat moves named in §10.5/§10.7/§10.8/§10.10). */
export function loadMovesYoshimitsu(): Move[] {
  // Deploy build: the 319-move pack is split into three JSON parts (each
  // under 90 kB) so every emitted dist chunk stays under the Vercel
  // file-upload argument limit. Concatenation order is the original pack
  // order; the merged array is identical to moves.yoshimitsu.json, which
  // is kept untouched for check-bundle / content-QA / e2e references.
  return moveSchema.array().parse([
    ...movesYoshimitsuJson1,
    ...movesYoshimitsuJson2,
    ...movesYoshimitsuJson3,
  ]);
}

/** Playbook — spec §10.13 counterplay table + Yoshimitsu game plans (§5.11). */
export const playbookItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  when: z.string().min(1).optional(),
  whatTheyDo: z.string().min(1).optional(),
  whatItBeats: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  risks: z.string().min(1).optional(),
  moveIds: z.array(z.string().min(1)).optional(),
  coreMoveIds: z.array(z.string().min(1)).optional(),
  drillIds: z.array(z.string().min(1)),
}).refine(
  (item) => (item.moveIds?.length ?? 0) + (item.coreMoveIds?.length ?? 0) > 0,
  { message: 'Every playbook item links to at least one move (AC-PB-1)' },
);
export const playbookPackSchema = z.object({
  counterplay: z.array(playbookItemSchema),
  plans: z.array(playbookItemSchema),
});
export type PlaybookItem = z.infer<typeof playbookItemSchema>;
export type PlaybookPack = z.infer<typeof playbookPackSchema>;

export function loadPlaybook(): PlaybookPack {
  return playbookPackSchema.parse(playbookJson);
}

/** The standing/crouching punisher ladder (§10.7: 9 enemy values x 2 postures). */
export function loadPunishers(): Punisher[] {
  return punisherSchema.array().parse(punishersJson);
}

/** All stances (§10.5): 1SS, NSS, KIN, DGF, FLE, IND, MED, BT, BDS and WFL. */
export function loadStances(): Stance[] {
  return stanceSchema.array().parse(stancesJson);
}

/** Every combo route in §10.12. */
export function loadCombos(): Combo[] {
  return comboSchema.array().parse(combosJson);
}

/** Stages, nodes and drills (§11.1/§11.2) in one curriculum pack (§11.3 shape). */
export function loadCurriculum(): CurriculumPack {
  return curriculumPackSchema.parse(curriculumJson);
}

/** The 42-character roster (§10.3) with Wavu and counterplay page URLs. */
export function loadRoster(): Character[] {
  return characterSchema.array().parse(rosterJson);
}

/** Data conflicts to verify (§10.14), seeding the conflicts table. */
export function loadConflicts(): DataConflict[] {
  return dataConflictSchema.array().parse(conflictsJson);
}

/** Flashcard seed decks and generated-card templates (§11.4). */
export function loadCardTemplates(): CardTemplatesPack {
  return cardTemplatesPackSchema.parse(cardTemplatesJson);
}

/** All seed packs at once, in pack-table load order. */
export function loadAllPacks(): {
  moves: Move[];
  punishers: Punisher[];
  stances: Stance[];
  combos: Combo[];
  curriculum: CurriculumPack;
  roster: Character[];
  conflicts: DataConflict[];
  cardTemplates: CardTemplatesPack;
  playbook: PlaybookPack;
} {
  return {
    moves: loadMovesYoshimitsu(),
    punishers: loadPunishers(),
    stances: loadStances(),
    combos: loadCombos(),
    curriculum: loadCurriculum(),
    roster: loadRoster(),
    conflicts: loadConflicts(),
    cardTemplates: loadCardTemplates(),
    playbook: loadPlaybook(),
  };
}
