// §6.2/§6.3 — Repository index. Repositories are the only code that touches IndexedDB (via `db`).
//
// Method signatures (all async; every `put` validates through its Zod schema
// and returns the validated record; `remove` resolves when the row is gone):
//
//   profileRepo:     get(): Promise<Profile | undefined>
//                    put(profile: Profile): Promise<Profile>
//                    all(): Promise<Profile[]>
//                    remove(): Promise<void>
//   settingsRepo:    get(): Promise<Settings | undefined>
//                    put(settings: Settings): Promise<Settings>
//                    all(): Promise<Settings[]>
//                    remove(): Promise<void>
//   packsRepo:       get(id: string): Promise<PackRecord | undefined>
//                    getById(id: string): Promise<PackRecord | undefined>
//                    getByKind(kind, patch?): Promise<PackRecord | undefined>
//                    put(pack: PackRecord): Promise<PackRecord>
//                    putMany(packs: PackRecord[]): Promise<PackRecord[]>
//                    all(): Promise<PackRecord[]>
//                    remove(id: string): Promise<void>
//   sessionsRepo:    get(id): Promise<Session | undefined>
//                    getById(id): Promise<Session | undefined>
//                    all(): Promise<Session[]>  (newest first)
//                    allByStatus(status): Promise<Session[]>
//                    put(session: Session): Promise<Session>
//                    remove(id: string): Promise<void>
//   setsRepo:        get(id) / getById(id): Promise<DrillSet | undefined>
//                    all(): Promise<DrillSet[]>  (oldest first)
//                    allBySession(sessionId) / allByDrill(drillId) / allByNode(nodeId)
//                      / allByDay(day): Promise<DrillSet[]>
//                    put(set: DrillSet): Promise<DrillSet>
//                    remove(id: string): Promise<void>
//   matchSetsRepo:   get(id) / getById(id): Promise<MatchSet | undefined>
//                    all(): Promise<MatchSet[]>
//                    allByDay(day) / allByCharacter(character): Promise<MatchSet[]>
//                    put(matchSet: MatchSet): Promise<MatchSet>
//                    remove(id: string): Promise<void>
//   reviewsRepo:     get(id) / getById(id): Promise<ReplayReview | undefined>
//                    all(): Promise<ReplayReview[]>
//                    allByMatchSet(matchSetId): Promise<ReplayReview[]>
//                    put(review: ReplayReview): Promise<ReplayReview>
//                    remove(id: string): Promise<void>
//   problemMovesRepo:get(id) / getById(id): Promise<ProblemMove | undefined>
//                    all(): Promise<ProblemMove[]>
//                    allByCharacter(character): Promise<ProblemMove[]>
//                    put(problemMove: ProblemMove): Promise<ProblemMove>
//                    remove(id: string): Promise<void>
//   moveNotesRepo:   get(moveId) / getById(moveId): Promise<MoveNote | undefined>
//                    all(): Promise<MoveNote[]>
//                    allByCharacter(character): Promise<MoveNote[]>
//                    put(note: MoveNote): Promise<MoveNote>
//                    remove(moveId: string): Promise<void>
//   cardsRepo:       get(id) / getById(id): Promise<Card | undefined>
//                    all(): Promise<Card[]>
//                    allByDeck(deck): Promise<Card[]>
//                    put(card: Card): Promise<Card>
//                    remove(id: string): Promise<void>
//   cardStatesRepo:  get(cardId) / getById(cardId): Promise<CardState | undefined>
//                    all(): Promise<CardState[]>
//                    allDue(dueOnOrBefore: ISODate): Promise<CardState[]>
//                    put(state: CardState): Promise<CardState>
//                    remove(cardId: string): Promise<void>
//   masteryRepo:     get(nodeId) / getById(nodeId): Promise<Mastery | undefined>
//                    all(): Promise<Mastery[]>
//                    allByState(state): Promise<Mastery[]>
//                    put(mastery: Mastery): Promise<Mastery>
//                    remove(nodeId: string): Promise<void>
//   stageStatusRepo: get(stageId) / getById(stageId): Promise<StageStatus | undefined>
//                    all(): Promise<StageStatus[]>
//                    allByState(state): Promise<StageStatus[]>
//                    put(status: StageStatus): Promise<StageStatus>
//                    remove(stageId: string): Promise<void>
//   snapshotsRepo:   get(id) / getById(id): Promise<Snapshot | undefined>
//                    all(): Promise<Snapshot[]>  (newest first)
//                    allByReason(reason): Promise<Snapshot[]>
//                    put(snapshot: Snapshot): Promise<Snapshot>
//                    remove(id: string): Promise<void>
//   errorsRepo:      get(id) / getById(id): Promise<ErrorRecord | undefined>
//                    all(): Promise<ErrorRecord[]>  (newest first)
//                    latest(limit = 50): Promise<ErrorRecord[]>
//                    put(error: ErrorRecord): Promise<ErrorRecord>
//                    remove(id: string): Promise<void>
//   assessmentsRepo: get(id) / getById(id): Promise<Assessment | undefined>
//                    all(): Promise<Assessment[]>
//                    put(assessment: Assessment): Promise<Assessment>
//                    remove(id: string): Promise<void>
//   verificationsRepo: get(id) / getById(id): Promise<VerificationRecord | undefined>
//                    all(): Promise<VerificationRecord[]>
//                    allByEntity(entityId): Promise<VerificationRecord[]>
//                    put(record: VerificationRecord): Promise<VerificationRecord>
//                    remove(id: string): Promise<void>
//   conflictsRepo:   get(id) / getById(id): Promise<DataConflict | undefined>
//                    all(): Promise<DataConflict[]>
//                    allByEntity(entityId): Promise<DataConflict[]>
//                    allOpen(): Promise<DataConflict[]>
//                    put(conflict: DataConflict): Promise<DataConflict>
//                    remove(id: string): Promise<void>
//   coachMessagesRepo: get(id) / getById(id): Promise<CoachMessage | undefined>
//                    all(): Promise<CoachMessage[]>
//                    allByThread(threadId): Promise<CoachMessage[]>
//                    put(message: CoachMessage): Promise<CoachMessage>
//                    remove(id: string): Promise<void>
//   metaRepo:        get(key) / getById(key): Promise<MetaRecord | undefined>
//                    all(): Promise<MetaRecord[]>
//                    put(record: MetaRecord): Promise<MetaRecord>
//                    remove(key: string): Promise<void>
//   mediaRepo:       all(): Promise<MediaAsset[]>  (oldest import first)
//                    get(id) / find(kind, subjectKey): Promise<MediaAsset | undefined>
//                    allBySubject(subjectKey): Promise<MediaAsset[]>
//                    put(asset, blobs): Promise<MediaAsset>  (replaces, one transaction)
//                    blob(key): Promise<Uint8Array | undefined>
//                    remove(id) / clear(): Promise<void>
//                    stats(): Promise<MediaStats>
//                    checkConsistency(repair): Promise<MediaConsistency>  (reads keys only, never bytes)
export { profileRepo } from './profile';
export { settingsRepo } from './settings';
export { packsRepo } from './packs';
export { sessionsRepo } from './sessions';
export { setsRepo } from './sets';
export { matchSetsRepo, reviewsRepo } from './matchSets';
export { problemMovesRepo, moveNotesRepo } from './problemMoves';
export { cardsRepo, cardStatesRepo } from './cards';
export { masteryRepo, stageStatusRepo } from './mastery';
export { snapshotsRepo } from './snapshots';
export {
  errorsRepo, assessmentsRepo, verificationsRepo, conflictsRepo, coachMessagesRepo, metaRepo,
} from './errors';
export { mediaRepo, mediaAssetId, blobKeysOf, type MediaConsistency, type MediaStats } from './media';
export { db, resetDbForTests, SCHEMA_VERSION } from '../db';
