// §6.4 — Zod schemas mirroring the entity types exactly; every write path validates through these.
import { z } from 'zod';

// ---------- shared ----------
export const isoDateSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().min(1);

export const stanceIdSchema = z.enum([
  '1SS', 'NSS', 'DGF', 'KIN', 'FLE', 'IND', 'MED', 'BT', 'BDS', 'WFL', 'FC', 'WS', 'SS', 'WR',
]);
export type StanceId = z.infer<typeof stanceIdSchema>;

export const provenanceSchema = z.object({
  source: z.enum(['wavu', 'tekkendocs', 'seed', 'user', 'derived']),
  sourceUrl: z.string().optional(),
  sourceRev: z.string().optional(),
  patch: z.string().min(1),
  fetchedAt: isoDateTimeSchema.optional(),
  status: z.enum(['verified', 'sourced', 'unverified', 'conflicting']),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** Seed provenance shared by every §10/§11 pack record: seed, patch 3.02.02, unverified (§6.5). */
export const seedProvenance: Provenance = {
  source: 'seed',
  patch: '3.02.02',
  status: 'unverified',
};

// ---------- packs: read-only, versioned ----------
export const moveTagSchema = z.enum([
  'heat-engager', 'heat-only', 'heat-smash', 'heat-burst', 'homing', 'power-crush',
  'launcher', 'ch-launcher', 'tornado', 'wall-splat', 'wall-break', 'floor-break',
  'balcony-break', 'unblockable', 'hp-cost', 'parry', 'throw', 'low-crush', 'high-crush',
  'plus-on-block', 'punisher-standing', 'punisher-crouching', 'whiff-punisher', 'panic',
  'keepout', 'stance-entry', 'rage-art', 'oki',
]);
export type MoveTag = z.infer<typeof moveTagSchema>;

export const moveSchema = z.object({
  id: z.string().min(1),
  character: z.string().min(1),
  num: z.number().int().optional(),
  input: z.string().min(1),
  parentId: z.string().optional(),
  name: z.string().optional(),
  aliases: z.array(z.string()),
  altInputs: z.array(z.string()),
  stance: stanceIdSchema.optional(),
  hitLevel: z.string(),
  damage: z.string(),
  startup: z.string(),
  startupFrame: z.number().int().optional(),
  block: z.string().optional(),
  blockMin: z.number().int().optional(),
  hit: z.string().optional(),
  counterHit: z.string().optional(),
  crush: z.string().optional(),
  recovery: z.string().optional(),
  total: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(moveTagSchema),
  videoUrl: z.string().optional(),
  provenance: provenanceSchema,
});
export type Move = z.infer<typeof moveSchema>;

export const punisherSchema = z.object({
  posture: z.enum(['standing', 'crouching']),
  enemy: z.number().int(),
  moveId: z.string().min(1),
  input: z.string().min(1),
  damage: z.number(),
  comboDamage: z.number().optional(),
  onHit: z.string(),
  onBlock: z.string(),
  heatOnly: z.boolean(),
  notes: z.string().optional(),
  provenance: provenanceSchema,
});
export type Punisher = z.infer<typeof punisherSchema>;

export const stanceSchema = z.object({
  id: stanceIdSchema,
  name: z.string().min(1),
  entries: z.array(z.object({ input: z.string().min(1), note: z.string().optional() })),
  fastest: z.array(z.object({
    level: z.enum(['high', 'mid', 'low', 'unblockable', 'throw']),
    startup: z.number().int(),
    moveId: z.string().optional(),
  })),
  uses: z.array(z.string()),
  risks: z.array(z.string()),
  counterplay: z.array(z.string()),
  provenance: provenanceSchema,
});
export type Stance = z.infer<typeof stanceSchema>;

export const comboSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['beginner', 'bnb', 'staple', 'heat', 'wall', 'float', 'bt', 'stage', 'mini', 'extra']),
  starters: z.array(z.string().min(1)),
  route: z.string().min(1),
  segments: z.array(z.string().min(1)),
  damage: z.number().optional(),
  requires: z.array(z.enum(['heat', 'nss', 'on-axis', 'ssl', 'wall', 'dash', 'counter-hit'])),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  notes: z.string().optional(),
  provenance: provenanceSchema,
});
export type Combo = z.infer<typeof comboSchema>;

export const characterSchema = z.object({
  name: z.string().min(1),
  wavuPage: z.string().min(1),
  counterplayPage: z.string().min(1),
  hasPack: z.boolean(),
});
export type Character = z.infer<typeof characterSchema>;

// ---------- curriculum pack ----------
export const metricIdSchema = z.enum([
  'drillSuccess', 'punishQuizAccuracy', 'missedPunishesPerGame', 'panicSuccessRate',
  'throwBreakRate', 'hitWhileMinusPerGame', 'lowBlockRate', 'heatWasteRate', 'okiPerGame',
  'cardRetention', 'verifiedShare',
]);
export type MetricId = z.infer<typeof metricIdSchema>;

/**
 * KPI-target override keys (D-060). These MUST match WeaknessMetric in
 * src/domain/engine/weakness.ts exactly: detectWeaknesses looks overrides up
 * by that id, so any drift silently disables the override. (metricIdSchema
 * above uses different spellings for four of these and is not used here.)
 */
export const weaknessMetricIdSchema = z.enum([
  'missedPunishesPerGame', 'panicSuccess', 'throwBreaks', 'hitWhileMinusPerGame',
  'lowsBlocked', 'heatWasted', 'okiPerGame',
]);
export type WeaknessMetricId = z.infer<typeof weaknessMetricIdSchema>;

export const kpiTargetSchema = z.object({
  metric: metricIdSchema,
  op: z.enum(['>=', '<=']),
  value: z.number(),
  window: z.object({
    kind: z.enum(['sets', 'games', 'days', 'questions']),
    n: z.number().int().positive(),
  }),
  minSample: z.number().int().nonnegative(),
});
export type KpiTarget = z.infer<typeof kpiTargetSchema>;

export const gateSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  criteria: z.array(kpiTargetSchema),
});
export type Gate = z.infer<typeof gateSchema>;

export const stageSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0).max(9),
  act: z.enum(['shu', 'ha', 'ri']),
  title: z.string().min(1),
  goal: z.string().min(1),
  nodeIds: z.array(z.string().min(1)),
  gate: gateSchema,
});
export type Stage = z.infer<typeof stageSchema>;

export const skillNodeSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
  title: z.string().min(1),
  why: z.string().min(1),
  prerequisites: z.array(z.string().min(1)),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  components: z.object({ knowledge: z.boolean(), execution: z.boolean(), application: z.boolean() }),
  drillIds: z.array(z.string().min(1)),
  cardDeck: z.string().optional(),
  codexRefs: z.array(z.string().min(1)),
  kpis: z.array(kpiTargetSchema),
});
export type SkillNode = z.infer<typeof skillNodeSchema>;

export const drillSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  title: z.string().min(1),
  type: z.enum(['execution', 'punish', 'reaction', 'knowledge', 'application', 'verify']),
  recipe: z.array(z.string().min(1)),
  steps: z.array(z.string().min(1)),
  repsPerSet: z.number().int().positive(),
  sets: z.number().int().positive(),
  target: z.object({ successRate: z.number().min(0).max(1), sets: z.number().int().positive(), days: z.number().int().positive() }),
  progressions: z.array(z.string()),
  regressions: z.array(z.string()),
  minutes: z.number().int().positive(),
  codexRefs: z.array(z.string().min(1)),
});
export type Drill = z.infer<typeof drillSchema>;

/** The curriculum pack file shape (§11.3): stages, nodes and drills in one versioned pack. */
export const curriculumPackSchema = z.object({
  stages: z.array(stageSchema),
  nodes: z.array(skillNodeSchema),
  drills: z.array(drillSchema),
});
export type CurriculumPack = z.infer<typeof curriculumPackSchema>;

/** Flashcard template (§11.4): `{field}` placeholders are filled from pack data at generation time. */
export const cardTemplateSchema = z.object({
  id: z.string().min(1),
  deck: z.string().min(1),
  frontTemplate: z.string().min(1),
  backTemplate: z.string().min(1),
  source: z.enum(['moves', 'punishers', 'stances', 'static']),
  fields: z.array(z.string().min(1)),
  notes: z.string().optional(),
});
export type CardTemplate = z.infer<typeof cardTemplateSchema>;

export const cardTemplatesPackSchema = z.object({
  decks: z.array(z.object({
    name: z.string().min(1),
    exampleFront: z.string().min(1),
    exampleBack: z.string().min(1),
  })),
  templates: z.array(cardTemplateSchema),
});
export type CardTemplatesPack = z.infer<typeof cardTemplatesPackSchema>;

// ---------- user data ----------
export const profileSchema = z.object({
  id: z.literal('me'),
  displayName: z.string().min(1),
  platform: z.enum(['ps5', 'pc', 'xbox']),
  controller: z.string().min(1),
  glyphMode: z.enum(['numeric', 'playstation', 'xbox']),
  tekkenId: z.string().optional(),
  currentRank: z.string().optional(),
  targetRank: z.string().min(1),
  targetDate: isoDateSchema.optional(),
  weeklyMinutes: z.number().int().nonnegative(),
  sessionMinutes: z.number().int().positive(),
  preferredDays: z.array(z.number().int().min(0).max(6)),
  dayBoundary: z.string().min(1),
  timezone: z.string().min(1),
  createdAt: isoDateTimeSchema,
  onboardingStep: z.number().int().nonnegative().optional(),
  /** §5.2 History step: "Played Yoshimitsu in Tekken 7?" (pre-set yes for Sagar). */
  playedTekken7: z.boolean().optional(),
  /** §5.2 History step: Tekken 8 hours so far (pre-set 0). */
  tekken8Hours: z.number().nonnegative().optional(),
});
export type Profile = z.infer<typeof profileSchema>;

export const sessionBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['warmup', 'drill', 'review', 'application', 'verify', 'gate']),
  drillId: z.string().optional(),
  minutes: z.number().int().positive(),
  reason: z.string().min(1),
  startedAt: isoDateTimeSchema.optional(),
  endedAt: isoDateTimeSchema.optional(),
});
export type SessionBlock = z.infer<typeof sessionBlockSchema>;

export const sessionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['plan', 'custom', 'gate', 'baseline']),
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema.optional(),
  status: z.enum(['active', 'paused', 'done', 'abandoned']),
  plannedMinutes: z.number().int().nonnegative(),
  blocks: z.array(sessionBlockSchema),
  currentBlock: z.number().int().nonnegative(),
  pausedMs: z.number().int().nonnegative(),
  reflection: z.string().optional(),
  /** A gate session is tied to one stage so the debrief can evaluate it. */
  gateStageId: z.string().optional(),
  /** Mastery before/after per node, persisted so the debrief survives a reload (E3). */
  masteryDeltas: z.record(z.string(), z.object({ before: z.number().nullable(), after: z.number().nullable() })).optional(),
});
export type Session = z.infer<typeof sessionSchema>;

export const drillSetSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().optional(),
  drillId: z.string().min(1),
  nodeId: z.string().min(1),
  at: isoDateTimeSchema,
  day: isoDateSchema,
  reps: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  side: z.enum(['p1', 'p2']).optional(),
  variant: z.string().optional(),
});
export type DrillSet = z.infer<typeof drillSetSchema>;

export const talliesSchema = z.object({
  missedPunishes: z.number().int().nonnegative(),
  flashHit: z.number().int().nonnegative(),
  flashBlocked: z.number().int().nonnegative(),
  flashWhiffed: z.number().int().nonnegative(),
  spinEscaped: z.number().int().nonnegative(),
  spinPunished: z.number().int().nonnegative(),
  throwsBroken: z.number().int().nonnegative(),
  throwsMissed: z.number().int().nonnegative(),
  hitWhileMinus: z.number().int().nonnegative(),
  lowsBlocked: z.number().int().nonnegative(),
  lowsEaten: z.number().int().nonnegative(),
  heatConverted: z.number().int().nonnegative(),
  heatWasted: z.number().int().nonnegative(),
  okiConverted: z.number().int().nonnegative(),
});
export type Tallies = z.infer<typeof talliesSchema>;

export const matchSetSchema = z.object({
  id: z.string().min(1),
  at: isoDateTimeSchema,
  day: isoDateSchema,
  mode: z.enum(['ranked', 'player', 'quick', 'tournament', 'offline']),
  opponentCharacter: z.string().min(1),
  opponentRank: z.string().optional(),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  focusNodeId: z.string().optional(),
  tallies: talliesSchema,
  beatBy: z.array(z.string()),
  notes: z.string().optional(),
  tags: z.array(z.string()),
  importRef: z.string().optional(),
});
export type MatchSet = z.infer<typeof matchSetSchema>;

export const replayReviewSchema = z.object({
  id: z.string().min(1),
  matchSetId: z.string().min(1),
  at: isoDateTimeSchema,
  answers: z.record(z.string(), z.union([z.number(), z.boolean()])),
  insights: z.array(z.string()),
});
export type ReplayReview = z.infer<typeof replayReviewSchema>;

export const problemMoveSchema = z.object({
  id: z.string().min(1),
  character: z.string().min(1),
  moveId: z.string().optional(),
  input: z.string().min(1),
  description: z.string().min(1),
  answer: z.object({
    kind: z.enum(['punish', 'block-high', 'block-low', 'duck', 'sidestep-left', 'sidestep-right', 'backdash', 'interrupt', 'parry', 'flash']),
    detail: z.string().min(1),
    punisherMoveId: z.string().optional(),
  }),
  verified: z.boolean(),
  drillId: z.string().optional(),
  /** Set when the linked move left the game-data pack (§7.7): the problem move is kept and marked. */
  removedFromData: z.boolean().optional(),
  cardId: z.string().optional(),
  createdFrom: z.enum(['log', 'manual', 'import']),
});
export type ProblemMove = z.infer<typeof problemMoveSchema>;

export const cardSchema = z.object({
  id: z.string().min(1),
  deck: z.string().min(1),
  templateId: z.string().optional(),
  front: z.string().min(1),
  back: z.string().min(1),
  refs: z.array(z.string()),
  createdAt: isoDateTimeSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const cardStateSchema = z.object({
  cardId: z.string().min(1),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  ease: z.number(),
  intervalDays: z.number().nonnegative(),
  due: isoDateSchema,
  lastGrade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  history: z.array(z.object({ at: isoDateTimeSchema, grade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) })),
});
export type CardState = z.infer<typeof cardStateSchema>;

export const masterySchema = z.object({
  nodeId: z.string().min(1),
  K: z.number().min(0).max(1).nullable(),
  E: z.number().min(0).max(1).nullable(),
  A: z.number().min(0).max(1).nullable(),
  score: z.number().min(0).max(100),
  state: z.enum(['locked', 'learning', 'practicing', 'solid', 'mastered', 'rusty']),
  placed: z.boolean(),
  evidenceDays: z.array(isoDateSchema),
  updatedAt: isoDateTimeSchema,
});
export type Mastery = z.infer<typeof masterySchema>;

export const stageStatusSchema = z.object({
  stageId: z.string().min(1),
  state: z.enum(['locked', 'open', 'passed']),
  passedAt: isoDateTimeSchema.optional(),
  viaPlacement: z.boolean(),
});
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const assessmentSchema = z.object({
  id: z.string().min(1),
  at: isoDateTimeSchema,
  results: z.record(z.string(), z.number()),
  placementStage: z.number().int().min(0).max(9),
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const verificationRecordSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  field: z.enum(['block', 'hit', 'startup', 'counterHit', 'other']),
  expected: z.string(),
  observed: z.string().optional(),
  result: z.enum(['match', 'mismatch']),
  patch: z.string().min(1),
  at: isoDateTimeSchema,
});
export type VerificationRecord = z.infer<typeof verificationRecordSchema>;

export const dataConflictSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  field: z.string().min(1),
  values: z.array(z.object({ source: z.string().min(1), value: z.string() })).min(2),
  status: z.enum(['open', 'resolved']),
  resolution: z.string().optional(),
});
export type DataConflict = z.infer<typeof dataConflictSchema>;

export const snapshotSchema = z.object({
  id: z.string().min(1),
  at: isoDateTimeSchema,
  reason: z.enum(['daily', 'pre-import', 'pre-migration', 'pre-pack-update', 'pre-reset', 'manual']),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().min(1),
  // Payload bytes (gzip when CompressionStream was available, else raw JSON
  // text). Uint8Array — not Blob: IndexedDB structured-clones byte arrays
  // faithfully in every environment, while Blob values do not survive
  // fake-indexeddb and add nothing here (D-059). The check is
  // realm-agnostic: jsdom's TextEncoder returns a Uint8Array from another
  // realm, so `instanceof Uint8Array` fails there.
  data: z.custom<Uint8Array>(
    (v): v is Uint8Array => Object.prototype.toString.call(v) === '[object Uint8Array]',
    { message: 'data must be a Uint8Array' },
  ),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const errorRecordSchema = z.object({
  id: z.string().min(1),
  at: isoDateTimeSchema,
  where: z.string().min(1),
  message: z.string().min(1),
  stack: z.string().optional(),
});
export type ErrorRecord = z.infer<typeof errorRecordSchema>;

// ---------- auxiliary rows for §6.3 tables with no §6.4 entity ----------
/** One-row settings record (§5.17, Appendix A.2 defaults). Key is always 'settings'. */
export const settingsSchema = z.object({
  id: z.literal('settings'),
  theme: z.enum(['system', 'dark', 'light']),
  glyphMode: z.enum(['numeric', 'playstation', 'xbox']).optional(),
  labAudioCues: z.boolean(),
  labWakeLock: z.boolean(),
  repsPerSet: z.number().int().positive(),
  newCardsPerDay: z.number().int().nonnegative(),
  reviewsPerDay: z.number().int().nonnegative(),
  aiProvider: z.enum(['none', 'openai-compatible', 'anthropic', 'mock']),
  aiRequestsPerHour: z.number().int().nonnegative(),
  /** Coach provider credentials (§5.17/§8.7). Optional; absent = unset. The key is stored only in IndexedDB, never logged or exported (AC-COACH-3). */
  aiApiKey: z.string().optional(),
  aiBaseUrl: z.string().optional(),
  aiModel: z.string().optional(),
  snapshotsKeptDaily: z.number().int().nonnegative(),
  snapshotsKeptEvent: z.number().int().nonnegative(),
  backupReminderDays: z.number().int().nonnegative(),
  inAppImporterEnabled: z.boolean(),
  matchImportEnabled: z.boolean(),
  dataPatch: z.string().min(1),
  dataSource: z.enum(['wavu', 'tekkendocs', 'seed']),
  kpiTargets: z.record(weaknessMetricIdSchema, z.number().nullable()),
  /** Media display preferences (Amendment 01B). Optional so rows written by
   * 1.0.0 stay valid; absent means the default noted on each field. */
  mediaShowArt: z.boolean().optional(), // default true
  mediaInkArt: z.boolean().optional(), // default false: grayscale ink tone for still art
  mediaClipAutoplay: z.boolean().optional(), // default true (never under reduced motion)
  mediaClipSpeedCodex: z.number().positive().max(1).optional(), // default 1
  mediaClipSpeedLab: z.number().positive().max(1).optional(), // default 0.5
  /** Add the images and clips the site itself serves (its /media folder) on
   * this device automatically; default true. Release 1.2.0. */
  mediaBundledAuto: z.boolean().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Versioned read-only pack stored in the `packs` table (§6.3). */
export const packRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['moves', 'punishers', 'stances', 'combos', 'curriculum', 'roster', 'conflicts', 'card-templates']),
  patch: z.string().min(1),
  version: z.string().min(1),
  updatedAt: isoDateTimeSchema,
  data: z.unknown(),
  provenance: provenanceSchema,
});
export type PackRecord = z.infer<typeof packRecordSchema>;

/** A user note on one move, keyed by moveId (§6.3 `moveNotes` table). */
export const moveNoteSchema = z.object({
  moveId: z.string().min(1),
  character: z.string().min(1),
  note: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type MoveNote = z.infer<typeof moveNoteSchema>;

/** One coach-history message (§6.3 `coachMessages` table). */
export const coachMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  at: isoDateTimeSchema,
  role: z.enum(['user', 'coach', 'system']),
  content: z.string().min(1),
  citations: z.array(z.string()),
});
export type CoachMessage = z.infer<typeof coachMessageSchema>;

/** A `meta` key/value row (§6.3): schema version, app version, install date, data version. */
export const metaRecordSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
export type MetaRecord = z.infer<typeof metaRecordSchema>;

// ---------- media library (Amendment 01B, release 1.1.0) ----------
// Images and clips that Sagar imports himself. They live only in this
// browser's IndexedDB (`media` + `mediaBlobs`), are never bundled into the
// build, never uploaded, and the app never fetches media from any site.

export const MEDIA_KINDS = [
  'character-icon', 'character-portrait', 'move-clip', 'rank-badge', 'game-logo', 'key-art',
] as const;
export const mediaKindSchema = z.enum(MEDIA_KINDS);
export type MediaKind = z.infer<typeof mediaKindSchema>;

/** character:<roster name>, move:<Wavu Move.id>, rank:<rank name>, or app:<slot>. */
export const mediaSubjectKeySchema = z.string().regex(/^(character|move|rank|app):\S.*$/, {
  message: 'subjectKey must look like character:<Name>, move:<Wavu move id>, rank:<rank> or app:<slot>',
});

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, { message: 'sha256 must be 64 lowercase hex characters' });

/** A downscaled copy of an imported image (portraits and key art). */
export const mediaVariantSchema = z.object({
  width: z.number().int().positive(),
  blobKey: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  mime: z.string().min(1),
});
export type MediaVariant = z.infer<typeof mediaVariantSchema>;

/** One imported image or clip (`media` table). One row per kind + subject:
 * importing the same kind and subject again replaces it. */
export const mediaAssetSchema = z.object({
  id: z.string().min(1),
  kind: mediaKindSchema,
  subjectKey: mediaSubjectKeySchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: sha256HexSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  blobKey: z.string().min(1),
  variants: z.array(mediaVariantSchema).optional(),
  /** pack: a media pack Sagar imported; file: a single file he added; site: the site's bundled media. */
  origin: z.enum(['pack', 'file', 'site']),
  sourcePage: z.string().optional(),
  credit: z.string().optional(),
  importedAt: isoDateTimeSchema,
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/** The bytes behind a media row (`mediaBlobs` table). Uint8Array, not Blob,
 * for the same reason as snapshots (D-059). */
export const mediaBlobSchema = z.object({
  key: z.string().min(1),
  data: z.custom<Uint8Array>(
    (v): v is Uint8Array => Object.prototype.toString.call(v) === '[object Uint8Array]',
    { message: 'data must be a Uint8Array' },
  ),
});
export type MediaBlob = z.infer<typeof mediaBlobSchema>;

/** One entry of a media pack's manifest.json. Unknown fields are ignored. */
export const mediaPackItemSchema = z
  .object({
    file: z.string().min(1),
    kind: mediaKindSchema,
    subjectKey: mediaSubjectKeySchema,
    mime: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, { message: 'sha256 must be 64 hex characters' }),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    sourcePage: z.string().nullable().optional(),
    credit: z.string().nullable().optional(),
  })
  .passthrough();
export type MediaPackItem = z.infer<typeof mediaPackItemSchema>;

/** manifest.json of a media pack (format zanshin-media-pack, version 1). */
export const mediaPackManifestSchema = z
  .object({
    format: z.literal('zanshin-media-pack'),
    version: z.literal(1),
    createdAt: z.string().optional(),
    items: z.array(mediaPackItemSchema),
  })
  .passthrough();
export type MediaPackManifest = z.infer<typeof mediaPackManifestSchema>;
