# ZANSHIN 1.4.1 — Codebase inventory (for 2.0 planning)

Repo `/home/claude/work/zanshin`, mapped on branch `v2/m0-foundations` @ `c16c77f` (docs/scripts only on top of `main` `f4d858f`, release 1.4.1; app code identical). `package.json` version 1.4.1, Dexie schema v5, backup format v1. Mapped read-only on 2026-11-01. All paths are repo-relative unless absolute.

Size: 258 files under `src/` (≈25.4k lines TS/TSX, ≈1.75k lines CSS); 32 screen `.tsx` files, 43 component `.tsx`, 24 services, 31 domain modules; tests ≈12.6k lines. ≈436 tracked files. `qa/`, `test-results/`, `playwright*.local.config.ts` are excluded via `.git/info/exclude` (local only, not in the repo).

---

## 1. Product surface

### 1.1 Routes (`src/app/App.tsx`)

All screens are `React.lazy` + per-route `RouteErrorBoundary` (`src/app/ErrorBoundary.tsx`), inside `<AppLayout/>`. `RequireOnboarding` redirects to `/onboarding` until onboarding is done; `/log*` opens from onboarding step 4 (`allowFromStep={4}`). `/onboarding`, `/baseline`, `/dev/gallery` have no guard. `/` → `/today`. `*` → inline "Not found" + link to Today. 32 screen routes.

| Route | Screen file | Purpose (one line) |
|---|---|---|
| `/onboarding` | `screens/onboarding/OnboardingScreen.tsx` | Steps 0–5: Welcome, Profile, Time, History, Calibration (baseline vs start at Stage 0), Placement preview; writes profile on every field (resumable). |
| `/baseline` | `screens/baseline/BaselineScreen.tsx` | Baseline runner (§11.5): Setup, Execution (stance entries, combos, Flash/Spin reps), Punish-sense quiz, Throw-break quiz, Notation quiz → placement (Stages 0–3 max). |
| `/today` | `screens/today/TodayScreen.tsx` | Yoshimitsu hero + one primary action, patch notice, 14-day backup prompt, 3 stat tiles, plan timeline (reason per block, Swap, Regenerate), top-2 focus meters, 6 quick-action tiles. |
| `/path` | `screens/path/PathScreen.tsx` | 10 stages in Shu/Ha/Ri acts, EnsoRing per node, gate status chips, "Take the gate test" / "Test out" (next locked stage only), hanko seal on passed. |
| `/path/:nodeId` | `screens/path/NodeDetailScreen.tsx` | Why it matters, K/E/A breakdown, unmet prerequisites, drills (start a session), card deck link, Codex refs, KPIs, lazy mastery chart (`NodeMasteryChart.tsx`). |
| `/lab` | `screens/lab/LabScreen.tsx` | Start today's planned session; custom session builder (add drill, minutes, Up/Down/Remove); add verify tasks from open conflicts; resume drafts/paused; past debriefs. |
| `/lab/session/:sessionId` | `screens/lab/SessionRunnerScreen.tsx` | Block runner (timestamp timers), RepLogger, clip picker, verify recording, Lab Mode (Space/0–9/U keys, wake lock, beeps), debrief with mastery deltas + gate result + reflection. |
| `/codex/moves` | `screens/codex/MoveExplorerScreen.tsx` | 319-move list: search (input/name/aliases), quick block-tier filters + Filters panel (startup, hit level, stance, properties, status, has notes), FrameLegend key, table on desktop. |
| `/codex/moves/:moveId` | `screens/codex/MoveDetailScreen.tsx` | Big four numbers, FrameBar, risks in words, opponent answers, parent/follow-ups, combos, drills, notes, verification history, Wavu link-out, clip. |
| `/codex/stances` | `screens/codex/StanceScreens.tsx` (`StanceMapScreen`) | Stance map SVG (`StanceMap`) + list of 10 stances. |
| `/codex/stances/:stanceId` | same (`StanceSheetScreen`) | Entries, fastest attack per hit level, plus-on-block routes, uses, risks, counterplay, drills. |
| `/codex/combos` | `screens/codex/ComboScreens.tsx` (`ComboLibraryScreen`) | 13 combo routes with success rate. |
| `/codex/combos/:comboId` | same (`ComboDetailScreen`) | Segments; "Practice this" → paused draft Lab session (segments then full route). |
| `/codex/heat` | `screens/codex/HeatScreen.tsx` | Universal Heat rules + Yoshimitsu Heat kit, HeatGauge, source/patch on each fact, stale-data warning (3.00.02). |
| `/punish` | `screens/punish/PunishScreen.tsx` | Tabs: Ladder quiz (punisher pack), Character quiz (needs opponent pack from Wavu), Lab routine (creates a Lab session); misses become flashcards. |
| `/matchups` | `screens/matchups/MatchupsScreen.tsx` | 42-character portrait grid, played first; win rate only from 10 games. |
| `/matchups/:character` | `screens/matchups/CharacterScreen.tsx` | Record ring, problem moves (from pack or free text → Lab drill + card), notes, counterplay links, on-demand pack import, web "Matchup primer". |
| `/playbook` | `screens/playbook/PlaybookScreen.tsx` | Counterplay table (10) + 6 game plans, each linking moves and Path nodes. |
| `/log` | `screens/log/LogListScreen.tsx` | Match sets, recent opponents first; New/Import buttons; per-row "Open matchup". |
| `/log/new`, `/log/:matchSetId/edit` | `screens/log/LogFormScreen.tsx` | Set form: date, mode, opponent (recent first), rank, games/wins, focus (prefilled from plan), 14 tally steppers, "What beat me" → problem move; save recomputes all mastery. |
| `/log/import` | `screens/log/ImportScreen.tsx` | CSV import (`date,opponent,character,result[,games,wins]`, dedupe); Wank/ewgf cards behind `FLAGS.matchImport` (false). |
| `/log/:matchSetId` | `screens/log/LogDetailScreen.tsx` | Set detail, problem moves, replay reviews (checklist answers + ≤3 insights), edit/delete. |
| `/progress` | `screens/progress/ProgressScreen.tsx` + `ProgressCharts.tsx` (lazy Recharts) | Mastery index, drill success, punish-quiz accuracy, missed punishes/game, win rate by character, minutes vs budget, consistency calendar, "Rank over time" (always hidden). |
| `/coach` | `screens/coach/CoachScreen.tsx` | Tabs: Weekly review (rules, history), Debriefs, Ask (AI or Copy context), Look it up (web research, keep as note). |
| `/cards` | `screens/cards/CardsScreen.tsx` | Deck list (total/due/fresh), generate seed cards, start review. |
| `/cards/review` | `screens/cards/CardReviewScreen.tsx` | Front → Reveal → Again/Hard/Good/Easy (keys 1–4); Again re-queues once; daily caps. |
| `/patch` | `screens/patch/PatchWatchScreen.tsx` | Current data, Check for updates (Wavu), Changes, Re-verification (conflicts), "Explain this update" (web brief), Snapshots + restore. |
| `/settings` | `screens/settings/SettingsScreen.tsx` | Profile, Time, History, Appearance, Images-and-clips link, Coach provider, Lab defaults, KPI targets, Data (export/import/snapshots/reset), About. |
| `/settings/media` | `screens/settings/MediaScreen.tsx` | Local media library: site media switch/Check now, import pack zip, add one file, display prefs, stored list, export zip, delete all. |
| `/diagnostics` | `screens/diagnostics/DiagnosticsScreen.tsx` | Versions, integrity checks (+re-run), storage, "Check intelligence function", media library, self-test (+copy report), last 50 errors, Safe Mode toggle. |
| `/dev/gallery` | `screens/dev-gallery/GalleryScreen.tsx` | Component gallery with theme/glyph switchers. Comment says "development builds only" but the route ships ungated in production. |

Dead screen: `screens/placeholder/PlaceholderScreen.tsx` (imported nowhere).

### 1.2 Navigation as built (`src/app/AppLayout.tsx`, `AppLayout.css`)

- `TABS` = Today `/today`, Lab `/lab`, Codex `/codex/moves`, **Matches** `/log`, Path `/path`. Order: Today · Lab · Codex · Matches · Path.
- **Phone (<600px)**: bottom tab bar = these 5 only. **No Settings, no "More".**
- **Tablet/desktop (≥600px)**: left rail = the 5 tabs + Settings (6 items).
- Hidden on `/onboarding`. In Lab Mode the shell renders only the scene, the session and one fixed "Exit Lab Mode" button.
- NavLink active state is prefix-based: Codex is active only under `/codex/moves*` (not stances/combos/heat); no tab is active on `/punish`, `/matchups*`, `/playbook`, `/progress`, `/coach`, `/cards*`, `/patch`, `/diagnostics`.
- Spec §4.13 asked for phone tabs **Today, Path, Lab, Codex, More (Punish, Matchups, Log, Progress, Coach, Cards, Patch Watch, Settings)**, two-pane tablet/desktop layouts, details in bottom sheets, a 240px rail and 1200px content. Built: no More, single column (max 880px; 1040px ≥1024), rail 208/236px, `Sheet` unused.

### 1.3 Reachability: where each secondary route is linked from (grep of `to=`/`navigate(`)

| Route | In-app entry points | Reachable on phone without deep link? |
|---|---|---|
| `/settings` | Rail only (≥600px); Today backup prompt (every 14 days) "Export a backup"; Coach Ask "Open Settings" (only with no provider); Media "← Back to Settings" | **Effectively no** (only via the periodic prompt or Coach card) |
| `/progress` | Today stat tiles "This week" and "Focus" | Yes (Today only) |
| `/cards` | Today "Cards due" tile; Today primary CTA when cards due; NodeDetail "Review cards"; CardReview back links | Yes (Today/Node) |
| `/cards/review` | Cards screen button | Yes |
| `/coach` | Today quick action "Ask the coach" | Yes (Today only) |
| `/punish` | Today quick action "Punish trainer" | Yes (Today only) |
| `/matchups` | Today quick action "Matchups" | Yes (Today only) |
| `/matchups/:character` | Matchups grid; Log list "Open matchup" | Yes |
| `/playbook` | Matchups lede link; Character page "Playbook" link | Yes (2 hops) |
| `/patch` | Today notice **only after an update was already applied** | **No** (circular: you must visit Patch Watch to apply the first update) |
| `/diagnostics` | Startup-repair toast "Open diagnostics"; route error boundary link | **No** (no Settings link) |
| `/codex/stances`, `/codex/stances/:id` | Only from each other (map ↔ sheet back link) | **No** |
| `/codex/combos` | Only "Back to the combo library" on a combo detail | Indirect (via a move's "Combo:" link → detail → back) |
| `/codex/combos/:id` | MoveDetail "Combo:" link; library | Yes (from move pages) |
| `/codex/heat` | **Nothing** | **No** |
| `/baseline` | Onboarding step 5 (Calibration = baseline) only | Only during onboarding |
| `/log/import` | Log list "Import matches" | Yes |
| `/settings/media` | Settings card button; Diagnostics link | Only via Settings (rail) |
| `/dev/gallery` | Nothing | No (dev only, but shipped) |
| `/path/:nodeId` | Path nodes; Today plan block titles; Playbook | Yes |
| `/lab/session/:id` | Today start/resume; Lab; Path gate; NodeDetail; Punish Lab routine; Combo "Practice this" (via Lab drafts) | Yes |

**Broken link**: `screens/coach/CoachScreen.tsx:52` `CitationChips` links to `/codex/move/${id}` (singular) → Not-found page. Correct route is `/codex/moves/:moveId`.

Top-bar title map `TITLES` (AppLayout.tsx) has no `/baseline` entry (falls back to "ZANSHIN").

---

## 2. Learning model (domain + services)

### 2.1 Curriculum (`src/data/packs/curriculum.json`, schema `curriculumPackSchema`)
- 10 stages, 50 nodes, 37 drills. Acts: Shu = Stages 0–3 (Calibration, Universal defense, Movement and spacing, Yoshimitsu core kit), Ha = 4–7 (Heat, Panic and keepout, Stances I: DGF/KIN/NSS, Okizeme and stances II), Ri = 8–9 (Matchups, Mastery — Stage 9 gate has no criteria).
- Nodes per stage: 3/6/4/6/6/6/5/6/4/4. Node fields: `prerequisites`, `importance` 1–3, `components` {knowledge, execution, application}, `drillIds`, `codexRefs`, `kpis`, `cardDeck` (23 nodes have one), `why`.
- **16 of 50 nodes have no drills**: n0-baseline, n2-stepblock, n4-dash-smash, n4-recoverable, n5-spin, n5-cd2, n6-traps, n7-unblockables, n7-stances2, n7-med-cancel, n8-sheets, n8-plans, n9-tech, n9-patch, n9-tournament, n9-style.
- Drill types: execution 17, application 6, punish 5, reaction 4, verify 3, knowledge 2. Drill fields: `recipe`, `steps`, `repsPerSet`, `sets`, `target` {successRate, sets, days}, `progressions`, `regressions`, `minutes`.
- Gate criteria metrics: drillSuccess ×15, punishQuizAccuracy ×2, missedPunishesPerGame ×2, throwBreakRate, hitWhileMinusPerGame, heatWasteRate, panicSuccessRate, okiPerGame; windows sets/games/questions.

### 2.2 Mastery — `src/domain/engine/mastery.ts` (§7.1)
- States: locked, learning, practicing (≥0.5), solid (≥0.8), mastered (≥0.9 with ≥3 sets over ≥2 days), rusty (was solid/mastered, now <0.8).
- Score M = weighted mean of non-null K 0.2 / E 0.5 / A 0.3. K = share of cards Good/Easy and not overdue (+ punish-quiz accuracy for punish nodes). E = recency-weighted (1.0…0.2) success over last 5 sets ÷ drill target, capped 1, halved every 14 days idle. A = mean KPI progress (KPIs under min sample dropped). Placed nodes with no evidence = solid 0.80.
- Live wiring: `services/lab.ts` `recomputeNodeMastery` / `recomputeAllMastery` (after each set, each match-log save/import, diagnostics repair). **It always passes `cards: []`, no `punishQuizAccuracy`, `stageOpen: stageIndex === 0`, `prerequisitesMet: true`** (lab.ts:133–146). KPI sources (`kpiInputsForNode`): match tallies; `verifiedShare` and `punishQuizAccuracy` "no source yet".

### 2.3 Gates — `src/domain/engine/gates.ts` (§7.2) + `services/stages.ts`
- `evaluateGate`: ≥80% of stage nodes solid/mastered (`GATE_SOLID_SHARE`) AND every criterion meets op/value with min sample. `evaluateStageStatus`: stage 0 open; a stage opens when the previous passes; passed never re-locks; `allowTestOut` lets the next locked stage pass directly. `placementGate`: punish quiz 20 questions instead of 40.
- `services/stages.ts` `syncStageStatuses()` builds evidence: drillSuccess from the last N sets of *any* drill in the stage; tallies for match metrics; quiz metrics from Assessment rows. Persists `stageStatus` rows.
- Gate sessions: Path builds a `kind: 'gate'` session of all stage drills; the debrief (`SessionRunnerScreen` `Debrief`) evaluates the gate once (`testOutStageId`).
- `services/placement.ts`: evaluates Stages 0–3 on baseline evidence, writes one Assessment, marks passed stages/nodes placed; never past Stage 3.
- Labels: `domain/engine/criteriaLabels.ts` (plain words for criterion ids and plan reasons).

### 2.4 Daily planner — `src/domain/engine/plan.ts` (§7.3), assembled by `src/app/planState.ts`
- Pure/deterministic (mulberry32 + FNV seed, `domain/engine/prng.ts`). Day type: rest if weekly minutes ≥110% of budget or ≥5 consecutive session days; light on non-preferred weekdays (half budget, 1 focus drill); else full.
- Primary action priority: resume-session → take-gate → rest-day → review-cards → log-matches → start-session.
- Blocks: warm-up 3 min (rusty node, else most recently mastered; skipped in Stage 0); review 0.3 min/due card (2–6); verify 2 min (≤3 open conflicts); application 35% of budget on match days (every 2nd session); focus drills fill the rest (≤3, ≥5 min each, no two consecutive same type). Priority = importance × (1−mastery) × weakness 1.5 × freshness × rusty 1.3 × unlock bonus.
- Every block has a `reason` (weakness detail e.g. "Missed punishes 3.0 per game vs target 2.0 (last 10 games)", or mastery/recency text). Today shows `plainReason()`. Swaps persist per date in localStorage `zanshin:plan-swaps:<date>`.
- `src/app/plan.ts` (`buildTodayPlan`, zero-mastery plan) is used only by the onboarding Placement preview.

### 2.5 Other engine modules (`src/domain/engine/`)
- `weakness.ts` — detects weaknesses over the last 10 logged games: missedPunishesPerGame, panicSuccess, throwBreaks, hitWhileMinusPerGame, lowsBlocked, heatWasted, okiPerGame; act-specific targets, trend, `KPI_TARGET_EDITOR` (Settings → KPI targets overrides `settings.kpiTargets`).
- `srs.ts` — SM-2 variant: grades 0–3, ease floor 1.3, interval cap 180 d, practice day with 04:00 boundary, `dueCount`.
- `adapt.ts` — §7.5 progression / regression / plateau / tilt decisions with coach notes. **Not called by any service or screen.**
- `stats.ts` — `weeklyConsistency` (sessions/minutes vs plan, no streaks; used by Today), `kpiRollups`, `findingSentence` (**unused outside tests**).
- `punish.ts` — data-driven answer rule: `isEligible`, `bestPunisher`, `scoreAnswer`, `answerKeyTable` (unused in app).
- `patch.ts` — `applyPatchImpact` (cards due, verify tasks, provenance reset) over a pack diff.

### 2.6 Lab (`services/lab.ts`, `domain/lab/blocks.ts`, `domain/lab/timer.ts`, `services/labMode.ts`)
- Session kinds: plan, custom, gate, baseline; statuses active/paused/done/abandoned. Block kinds: warmup, drill, review, application, verify, gate.
- `resolveBlock` resolves a block to a curriculum drill, a combo segment/full route (`combo-seg:<id>:<i>`, `combo-full:<id>`), a verify task (`verify:<conflictId>`), or a problem-move drill (`problem:<id>`).
- Timers derive from stored timestamps (reload-safe). Every set persists immediately; debrief keeps `masteryDeltas`. Lab Mode: `.z-lab` larger type, wake lock (silent fallback), Web Audio beeps (setting), keyboard Space/0–9/U; update toast held while a session is active (`services/updateGate.ts`).

### 2.7 Punish Trainer (`services/punish.ts`, `screens/punish/PunishScreen.tsx`)
- Ladder from `punishers.json` (18 rows: enemy −6, −8, −10, −11, −13, −14, −15, −17, −18 × standing/crouching). Seeded question builders, option builders, explanations. Note in file: §5.10 rule makes NSS.1+4 the best answer at −8…−14 standing, ahead of the §10.7 per-rung rows. Character quiz uses opponent packs (`moves-<Character>` in `packs`). Missed questions → `cardForMissedQuestion` flashcards. Quiz results → Assessment rows (gate evidence).

### 2.8 Flashcards (`services/cards.ts`, `card-templates.json`)
- 8 decks / 8 templates: Notation, Core moves, Punish ladder, Crouching punishes, Stances (pack-derived); Heat kit, Counterplay, Universal systems (static). Seed cards generated on demand; caps from settings (`newCardsPerDay` 10, `reviewsPerDay` 60; **no UI to edit them**). SRS via `domain/engine/srs.ts`. Card grades do **not** feed node mastery (see 2.2).

### 2.9 Match Log
- `MatchSet` (`schemas.ts`): id, at, day, mode (ranked/player/quick/tournament/offline), opponentCharacter, opponentRank?, games, wins, focusNodeId?, `tallies` (14: missedPunishes, flashHit/Blocked/Whiffed, spinEscaped/Punished, throwsBroken/Missed, hitWhileMinus, lowsBlocked/Eaten, heatConverted/Wasted, okiConverted), beatBy[], notes?, tags[], importRef?.
- `ReplayReview`: matchSetId, answers (record of number|boolean), insights[] (≤3). `ProblemMove`: character, moveId?, input, description, answer {kind: punish/block-high/block-low/duck/sidestep-left/right/backdash/interrupt/parry/flash, detail}, verified, drillId?, cardId?, createdFrom log/manual/import.
- Import (`src/data/import/matches.ts`): `parseMatchCsv` (verified path), dedupe `isDuplicateBattle`; `fetchWankBattles` (`https://wank.wavu.wiki/<id>?_format=json`, shape "UNVERIFIED") and `fetchEwgfBattles` (`https://api.ewgf.gg/external/battles/<id>`, token per import) are **flagged off** (`FLAGS.matchImport = false`). Import screen copy says "Enable matchImport in Settings" — no such setting exists.

### 2.10 Progress (`services/progress.ts`)
- Pure chart builders + `loadProgressData`; min samples 10 games / 3 sets; hidden charts state the reason. `rankHiddenReason` is a constant: rank history is not recorded (stub).

### 2.11 Playbook / Matchups / Patch Watch
- `playbook.json`: 10 counterplay rows (when/whatTheyDo/whatItBeats/answer/risks + moveIds/drillIds) and 6 plans (Keepout, Punish into oki, Heat, Comeback, Anti-turtle, Anti-aggression). Loaded directly (not stored in `packs`).
- `services/matchups.ts`: `importCharacterPack` (Wavu, cached as `moves-<Character>` pack row), `createProblemMove` (links a Lab drill `problem:<id>` and a card).
- `services/patchWatch.ts`: `checkForUpdates` via the Wavu importer, diff (`data/import/diff.ts`), apply with snapshot first → writes the new moves pack into `packs`, makes linked cards due, queues one open DataConflict per changed move, `lastAppliedSummary` for Today. **All Codex/Lab/Cards/Coach screens read the bundled JSON (`loadMovesYoshimitsu()`), not the stored pack**, so an applied update does not change what the Codex shows.

### 2.12 Coach (`services/coach.ts`, `src/domain/coach/*`)
- `rules.ts`: `weeklyReview`, `sessionDebrief`, `plateauNote`, `matchupBrief`, `patchSummary` (each ends with one "Next action:" line; snapshot-tested). Used: weekly review, debriefs, patch summary. **`plateauNote` and `matchupBriefText` are not used by any screen.**
- `context.ts`: Markdown context bundle ≤6,000 tokens (4 chars/token), ≤12 Codex entries, oldest session logs dropped first. `checker.ts`: frame-token extraction, flags numbers not in context, sanitizes Markdown. `providers/`: `anthropic.ts` (browser-direct), `openai.ts` (OpenAI-compatible base URL), `mock.ts`, `zanshin.ts` (site function), shared `fetchWithRetry` (30 s timeout, 2 s retry).
- `askCoach`: rate limit `aiRequestsPerHour` (default 20; stamps in localStorage), fallback to rules text on any failure, single Next action enforced, citations → move chips (broken link, §1.3).

---

## 3. Data

### 3.1 Bundled packs (`src/data/packs/`, loaders in `index.ts`, all Zod-validated)
| File | Contents |
|---|---|
| `moves.yoshimitsu.json` (255 kB raw, 27.9 kB gz) | 319 moves (312 provenance `wavu`, 7 `seed`); fields id, num, input, name, aliases, altInputs, parentId, character, hitLevel, damage, startup/startupFrame, block/blockMin, hit, recovery, total, notes, tags, provenance. Top tags: low-crush 84, floor-break 64, balcony-break 62, launcher 52, high-crush 48, ch-launcher 36, unblockable 32, plus-on-block 28. |
| `moves.yoshimitsu.{1,2,3}.json` | Same 319 moves split in 3 (identical concatenation) for chunking; the app loads these. |
| `stances.json` | 10 stances: NSS, KIN, DGF, FLE, IND, MED, BT, BDS, WFL, 1SS (entries, fastest, uses, risks, counterplay). |
| `combos.json` | 13 combos (staple 5, bnb 3, mini 2, beginner, heat, wall) with route, segments, starters, requires, difficulty. |
| `roster.json` | 42 characters with Wavu and counterplay page URLs; `hasPack` true only for Yoshimitsu. |
| `punishers.json` | 18 punisher rows (see 2.7). |
| `conflicts.json` | 12 data conflicts to verify (all `open`). |
| `curriculum.json` | 10 stages, 50 nodes, 37 drills. |
| `card-templates.json` | 8 decks, 8 templates. |
| `playbook.json` | 10 counterplay + 6 plans. |
Constants: `DATA_PATCH = '3.02.02'`, `DATA_SOURCE = 'wavu+seed'`, `PACK_VERSION = '1.0.0-wavu-62125'` (Wavu revision 62125). Ranks list + default target in `src/config/ranks.ts`.

### 3.2 Dexie (`src/data/db.ts`, DB `zanshin`, `SCHEMA_VERSION = 5`)
v1 base → v2 `reviews.at` index → v3 snapshot payload Uint8Array → v4 media tables → v5 research table. Pre-migration snapshot via probe connection (`src/data/migrate.ts`).
| Table (key, indexes) | Holds |
|---|---|
| `meta` (key) | key/value: schema/app/data version, backup prompt/export dates, patch revision, bundled-media record |
| `profile` (id='me') | display name, platform, controller, glyphs, Tekken ID, current/target rank, target date, weekly/session minutes, preferred days, day boundary, timezone, onboardingStep, playedTekken7, tekken8Hours |
| `settings` (id='settings') | theme, scheme, glyphMode, Lab audio/wake lock, repsPerSet, card caps, aiProvider/key/baseUrl/model/requestsPerHour, snapshot retention, backupReminderDays, inAppImporterEnabled, matchImportEnabled, dataPatch/source, kpiTargets, media prefs |
| `packs` (id, kind, patch) | versioned pack copies (8 kinds) + opponent packs `moves-<Character>` |
| `sessions` (id, startedAt, status) | Lab sessions with blocks, masteryDeltas, gateStageId, reflection |
| `sets` (id, sessionId, drillId, nodeId, day, at) | drill sets (reps, successes, side, variant) |
| `matchSets` (id, day, opponentCharacter, importRef, at) | match log |
| `reviews` (id, matchSetId, at) | replay reviews |
| `problemMoves` (id, character) | problem moves |
| `moveNotes` (moveId, character) | per-move notes |
| `cards` (id, deck, createdAt), `cardStates` (cardId, due) | flashcards and SRS state |
| `mastery` (nodeId, state), `stageStatus` (stageId, state) | engine results |
| `assessments` (id, at) | quiz/baseline/placement results |
| `verifications` (id, entityId, at), `conflicts` (id, entityId, status) | data verification |
| `coachMessages` (id, threadId, at) | coach history |
| `snapshots` (id, at, reason) | gzip payloads; reasons daily/pre-import/pre-migration/pre-pack-update/pre-reset/manual |
| `errors` (id, at, where) | error ring buffer (50) + quarantined rows |
| `media` (id, kind, subjectKey, importedAt), `mediaBlobs` (key) | media library rows and bytes |
| `research` (id, kind, subjectKey, createdAt) | web notes: kind answer/primer/patch, citations, model, costUsd, revision |

Repos (`src/data/repos/*.ts`, index documents every method): profile, settings, packs, sessions, sets, matchSets+reviews, problemMoves+moveNotes, cards+cardStates, mastery+stageStatus, snapshots, errors+assessments+verifications+conflicts+coachMessages+meta (`errors.ts`), media, research. Seeding: `src/data/bootstrap.ts` (`ensureIdentity` gates first paint; `seedPacks` in background; default profile "Sagar", PS5/DualSense, 300 min/week, 30-min sessions, America/Chicago).

### 3.3 Backup (`src/services/backup.ts`)
`{ format: 'zanshin-backup', schemaVersion: 1, appVersion: '1.4.1', exportedAt, includesPacks, includesSecrets, tables, sha256 }`; sha256 over canonical JSON (sorted keys) of `tables`. 19 tables always: profile, settings, sessions, sets, matchSets, reviews, mastery, stageStatus, cards, cardStates, moveNotes, assessments, conflicts, problemMoves, coachMessages, verifications, errors, meta, research. `packs` opt-in; `aiApiKey` stripped unless secrets opted in. Not in backup: snapshots, media, mediaBlobs (media has its own zip export). Import: validate format/version/hash → snapshot → replace. `clearAllUserTables` for reset. `APP_VERSION` is hard-coded here (also used by main.tsx/siteAccess).

### 3.4 Media pipeline
- Script `scripts/make_zanshin_media_pack.py` (stdlib; Pillow optional → 1080px WebP): downloads roster icons/portraits + every Yoshimitsu move clip (+ `--opponents`) from Wavu; zip mode or `--site-dir public` mode (content-addressed files + `public/media/manifest.json`); cache `.zanshin-media-cache`; ≤2 req/s. Offline test `scripts/tests/test_media_pack.py`. `scripts/ensure-media-manifest.mjs` writes an empty manifest for local/PR builds (current `public/media/manifest.json` is empty).
- App: `services/bundledMedia.ts` reads `/media/manifest.json` from its own origin on idle (≤every 6 h, again on `online`), imports missing items (not precached by the SW). `services/mediaPack.ts` (`importMediaItems`, verify sha256, variants 320/640/1080, ≤300 MB/file, `addMediaFile`, delete), `services/mediaZip.ts` (fflate, Media screen only), `services/mediaLibrary.ts` (in-memory + localStorage index, object URLs, prefs hooks). Subject keys (`domain/media/subjects.ts`): `character:<Name>`, `move:<Wavu id>`, `rank:<rank>`, `app:logo|key-art`; kinds character-icon, character-portrait, move-clip, rank-badge, game-logo, key-art; origin pack/file/site.

### 3.5 Wavu importer (`src/data/import/`)
- `wavu.ts`: Cargo API `https://wavu.wiki/w/api.php`, paged (limit 200), `fetchRevisionId`, `mapCargoRow` (entity decoding), `resolveFullInput`. `parse.ts` frame strings; `clean.ts` wikitext stripping; `tags.ts` derived tags + curated lists; `diff.ts` patch diff; `tekkendocs.ts` fallback (`https://tekkendocs.com/api/t8`) — **used only by `scripts/import-wavu.ts`**, not in-app.
- Consumers: `scripts/import-wavu.ts` (CLI, writes to `/tmp/zanshin-import/` unless `--write`), Patch Watch, opponent packs (Character page, Punish character quiz). `scripts/content-qa-wavu.ts` samples 30 moves vs live Wavu.

---

## 4. Intelligence

- Entry `netlify/functions/intel.mts` → `createIntelHandler` (`src/server/intel/handler.ts`). Env: `PERPLEXITY_API_KEY`, `INTEL_DAILY_CAP_USD` (default 3; 0 = no cap). Provider timeout 45 s (2.0 M1; sync limit 60 s). One `ZT1` breadcrumb per request.
- Upstream: Perplexity Agent API `https://api.perplexity.ai/v1/agent` (`src/server/intel/perplexity.ts`), cost read from `usage.cost.total_cost`.
- Routes under `/.netlify/functions/intel/`: `GET health` (key configured, cap, today, models, durableStore), `GET usage` (7 days), `POST coach` {system, messages ≤20, model?, maxTokens 50–1200} (no web tool; messages flattened to one transcript), `POST research` {question, context?, model?, recency?}, `GET primer/:name` (cached 30 days, `?refresh=1`, stale primer returned on refresh failure), `POST patch-brief` {revision, patch?, changes ≤60, refresh?} (cached by revision).
- Models (`src/domain/intel/models.ts`): anthropic/claude-sonnet-5-5, anthropic/claude-haiku-5-5 (default coach), openai/gpt-6-luna, google/gemini-3.8-flash, perplexity/sonar (default research). Unknown models refused. Primers and briefs always use Sonar with web search. Output caps: coach 600, research 450, primer 550, patch 500 tokens (`prompts.ts`).
- Web search restricted to `TEKKEN_SOURCES`: wavu.wiki, tekkendocs.com, tekken.com, bandainamcoent.com, reddit.com, eventhubs.com, dashfight.com, youtube.com, tekkenzaibatsu.com. Prompts tell the model to write frame numbers as "reported".
- Spend cap: every paid call reads `usage/<YYYY-MM-DD>` first → 429 with plain message when `capUsd > 0 && today.costUsd >= capUsd`; records cost after. 503 when key missing.
- Blobs: `getStore({ name: 'intel', consistency: 'strong' })`; keys `usage/<day>/<requestId>~c<µUSD>~i<in>~o<out>` (one per paid call, `onlyIfNew`, summed by prefix; the 1.3 `usage/<day>` key is still read), `primer/<lowercased name>`, `patch/<revision>`. Falls back to a per-instance memory store if Blobs is unavailable (`src/server/intel/store.ts`).
- Telemetry (2.0 M1): `netlify/functions/diag.mts` → `/api/diag` (POST, rate limit 60/min) → `createDiagHandler` (`src/server/diag/handler.ts`); schema shared with the client in `src/server/diag/schema.ts`; one `ZT1` log line per event (`src/server/diag/zt1.ts`); Blobs store `diag` / `diag-<context>`, keys `<YYYY-MM-DD>/<ts>-<rand>`, ≤500/day. See REFERENCE §6 "Telemetry".
- Clients: `services/intel.ts` (`intelHealth`, `intelUsage`, `research`, `matchupPrimer`, `patchBrief`, 50 s timeout, `formatSpend`); `services/research.ts` (`lookUp`, `fetchPrimer`/`storedPrimer`, `fetchBrief`/`storedBrief`, notes CRUD in `research` table; `domain/intel/research.ts` checks prose, flags frame-like tokens, builds ≤4000-char context with the player's record/problem moves); `domain/coach/providers/zanshin.ts` (POST coach).
- Coach today: providers `none` (default: rules only + "Copy context for any AI"), `zanshin` (site function, model picker in Settings), `openai-compatible` (key + base URL + model, browser-direct), `anthropic` (key, browser-direct with dangerous-direct-browser-access header), `mock` (offered in prod UI as "Mock (development)"). Look it up model picker: Sonar / Claude Haiku 5.5 / Claude Sonnet 5.5. Settings shows today's spend + 7 days; "Test connection" reads health (free); Diagnostics "Check intelligence function". CI deploy probes `/intel/health` (401 expected behind SSO).

---

## 5. Platform

### 5.1 Services (`src/services/*.ts`)
| File | One line |
|---|---|
| `backup.ts` | Canonical-JSON backup export/validate/import, SHA-256 (WebCrypto + pure-TS fallback), reset. |
| `backupPrompt.ts` | 14-day backup prompt due logic (meta keys). |
| `baseline.ts` | Baseline protocol as data, baseline Session builder, pack-derived quiz builders. |
| `bundledMedia.ts` | Seeds the site's `/media` into IndexedDB (idle, 6 h interval, online). |
| `cards.ts` | Seed card generation from packs/templates, review queue + caps, grade and schedule. |
| `coach.ts` | Rules texts, context building, provider selection, rate limit, ask with fallback, test connection, `resolveMoveId`. |
| `diagnostics.ts` | Integrity checks with repairs, invalid-row quarantine, self-test. |
| `errorReport.ts` | Global error/unhandledrejection → errors ring buffer (50), ≤1 toast/min, secret redaction, quota message. 2.0 M1: telemetry queue → `POST /api/diag` (sendBeacon, dedupe by fingerprint, Settings toggle, site only) and the boot self-test. |
| `intel.ts` | HTTP client for the intel function. |
| `lab.ts` | Session creation (plan/custom), log/undo sets, advance, verification records, mastery recompute. |
| `labMode.ts` | Wake Lock + Web Audio beeps. |
| `matchups.ts` | Opponent pack import/cache, problem-move creation (drill + card). |
| `mediaLibrary.ts` | Read-side media index, object URLs, media prefs hooks. |
| `mediaPack.ts` | Media item verification/storage (shared by zips and site media). |
| `mediaZip.ts` | Read/write media pack zips (fflate). |
| `patchWatch.ts` | Wavu update check, diff, apply with snapshot, verify tasks, last-applied summary. |
| `placement.ts` | Baseline placement over Stage 0–3 gates. |
| `progress.ts` | Progress chart builders + loader. |
| `punish.ts` | Ladder/character quiz builders, scoring, explanations, Lab routines. |
| `research.ts` | Look it up, primers, briefs, research notes. |
| `siteAccess.ts` | `/version.json` probe (start, foreground ≤5 min, online): 401/403 → "Sign in again" banner; other version → `registration.update()`. |
| `snapshots.ts` | Daily + event snapshots (7 daily, 5 event; constants), gzip via CompressionStream, restore. |
| `stages.ts` | Gate evidence assembly + stage status sync; due cards by deck. |
| `updateGate.ts` | Holds the "Update available, reload" toast while a Lab session is active. |

### 5.2 Store, config, flags
- One Zustand store `src/stores/appStore.ts`: ready, profile, settings, toasts, online, labMode + load/saveProfile/saveSettings/pushToast/dismissToast/setOnline/setLabMode.
- `src/config/flags.ts` `FLAGS` (compile-time constants): baseline, coachAI, coachRules, codex, engine, flashcards, inAppImporter, lab, matchLog, patchWatch, punishTrainer, pwa = true; **matchImport = false**. Only `matchImport`, `inAppImporter` and `baseline` are actually read (Import, Character, Punish, Onboarding screens).
- Settings fields stored but **never read**: `inAppImporterEnabled`, `matchImportEnabled`, `backupReminderDays`, `snapshotsKeptDaily`, `snapshotsKeptEvent` (constants are used instead).
- Theme (`src/app/theme.ts`): `data-theme` dark|light on `<html>`, `data-scheme` manji|crimson|heat; localStorage `zanshin-theme`/`zanshin-scheme`, mirrored in settings.

### 5.3 Resilience
- Safe Mode (`src/config/safeMode.ts`): `?safe=1` or localStorage `zanshin:safe-mode`; banner "Safe Mode — seed packs, read-only. Export still works."; SW not registered, bundled media off; write actions disabled in 11 screens/services via `isSafeMode()` + `SafeModeNote`. Diagnostics copy still says "Full Safe Mode behavior arrives in a later phase" (stale).
- Startup integrity checks (`runIntegrityChecks`, idle, toast → Diagnostics): schema-version, packs-valid (reseed), records-validate (quarantine invalid rows into `errors`), orphans, stale-sessions (>12 h), mastery-sample (recompute), media rows vs bytes, clock. Self-test adds db-roundtrip, packs-tokenize, plan-dryrun, service-worker, storage estimate/persist, Wavu reachability.
- Bootstrap (`src/main.tsx`): pre-migration snapshot guard → global error handlers → render → SW registered on idle (`registerType: 'prompt'`) → `startSiteAccessWatch`.
- PWA (`vite.config.ts`): manifest with `useCredentials: true` (SSO), precache js/css/html/svg/png/woff/json, `media/**` and `version.json` excluded, `navigateFallbackDenylist /.netlify/`, no runtime caching; plugins inject font preloads + modulepreload of OnboardingScreen, emit `/version.json`. Standalone single-file build `vite.standalone.config.ts`.
- Hosting: `public/_headers` (CSP `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`, `img/media-src 'self' blob: data:`, frame-ancestors none, HSTS, Permissions-Policy wake-lock/fullscreen), `public/_redirects` (`/media/*` 404, SPA fallback), `netlify.toml` (`scripts/netlify-build.sh`, functions dir, Node 22, Python 3.12). Production URL in CI: `https://glistening-conkies-c028b3.netlify.app` (private, Netlify team SSO).

---

## 6. Design system

### 6.1 Tokens (`src/styles/tokens.css`, 148 lines — the only place colours may live)
- Shared: spacing 4px grid (`--space-1`…`--space-16`), radii chip 6 / control 10 / card 16 / sheet 22 / pill, motion (press 120, standard 200, sheet 320, enso 600 ms), fonts display Shippori Mincho B1, sans IBM Plex Sans, mono IBM Plex Mono (`@fontsource`), patterns seigaiha/asanoha/lattice/grain as SVG masks.
- Schemes: **Manji Night** (default dark, `:root, [data-theme="dark"]`): bg #0A0D14, accent cyan #4CC9F0, accent-2 ember #FF8F4A, seigaiha. **Crimson Dojo** (`[data-scheme="crimson"]`): bg #0F0A0A, vermilion #F0545A, gold #E2AE4A, asanoha. **Heat Surge** (`[data-scheme="heat"]`): bg #0B0916, violet #A898FF, cyan #5FD0FF, lattice. **Washi Daylight** (`[data-theme="light"]`): paper #F3EEE4, seal red #B32D1C, indigo #1F4E8C.
- Signals with one meaning each: `--fa-plus`, `--fa-punish` (−10…−14), `--fa-launch` (≤−15), `--hl-low`, `--heat`/`--heat-glow`, `--mastery`, `--info`, `--warning`, `--seal`. Derived glass tokens via `color-mix` (`--glass` 80% surface, `--glass-strong` 90% raised, `--accent-soft` 16% accent). `prefers-reduced-transparency` → solid panels, no scene art. AA contrast asserted by `tests/unit/design/contrast.spec.ts`.
- `src/styles/base.css` (type scale, `.z-lab` type boost, utilities), `fonts.css`.

### 6.2 Components (`src/components/`)
- base (20): Button, Card, Chip, CountStepper, DataBadge, EmptyState, ErrorState, Field.css, IconButton, Modal, ProgressLine, SafeModeNote, Select, Sheet (+`useFocusTrap`), Skeleton, StatTile, Stepper, Tabs, TextField, Toast, Toggle. **Unused outside the gallery: Sheet, Modal, StatTile, ProgressLine; EmptyState only in the dead PlaceholderScreen.**
- signature (13 + Supporting.css): CoachMessage, DrillCard, EnsoRing, FrameBar, FrameValue (+`frameTier`), HeatGauge, HitLevelChips, InputString (glyph modes numeric/PlayStation/Xbox), MatchupCard, PatchBanner, PunishLadder, RepLogger, StanceMap, Supporting.css. **MatchupCard and PatchBanner are gallery-only.**
- decor: `Scene` (fixed layer: gradient + two glows, pattern, grain, BrushEnso 520px, 残心 watermark, route character render at the edge, Embers; quiet on `/lab/session`; no figure on `/today` and character pages, which have stage heroes), `Ornaments` (BrushEnso, BrushStroke, KatanaDivider, Hanko, Embers).
- media: `CharacterArt` (CharacterIcon, CharacterHero stage with blurred ambient copy, CharacterPortrait, `useHasCharacterHero`), `MediaImage`, `MoveClip` (MoveClip, MoveClipCard, ClipToggle, MoveClipPicker, ClipBadge, `useHasClip`).
- Others: `layout/PageHeader` (eyebrow + display title + lede + actions; level 1|2), `codex/FrameLegend` (frame-data key), `research/ResearchNoteView` (Web-sourced badge, citations), `coach/markdown.tsx` (`renderSafeMarkdown`), `icons.tsx` (56 hand-drawn 24px icons incl. per-stance and move-property icons).
- Unused assets: all 18 SVGs in `src/assets/` (empty-*, hero-ink, stage-0…9, texture-paper) are imported nowhere; `public/brand/seal-gate.svg` and `wordmark.svg` unused (only `logo-mark.svg` is used).

### 6.3 The current nav look (exact, `src/app/AppLayout.css`)
- **Top bar** `.z-topbar`: sticky, min-height 60px, padding 8/16px, glass (`--glass`, `backdrop-filter: blur(18px) saturate(1.3)`), 1px bottom border `--glass-border`, plus a 1px gradient hairline (transparent → `--accent-line` 30% → `--accent-2` 60% → transparent, opacity 0.6). Left: 30px logo mark + "ZANSHIN" wordmark (display font 800, 15px, letter-spacing 0.18em; hidden below 600px). Center/flex: `<h1>` screen title (display 700, 20/28px, ellipsis, focused on route change). Right: DataBadge "sourced" with "wavu+seed · 3.02.02" (icon-only on phones). Below it, stacked banners: Safe Mode, sign-in expired (3px `--warning` top border, Sign in again / Later), Offline.
- **Phone tab bar** `.z-tabbar` (<600px): a floating pill — fixed 12px from left/right/bottom, 4px padding, `--glass-strong` + blur(20px) saturate(1.3), 1px `--glass-border`, radius 20px, `--shadow-overlay`. Five equal flex links, min-height 56px, icon 22px stacked over a 12px/500 label (letter-spacing 0.02em), `--text-2`, link radius 16px. Active: `--text-1`, weight 600, `--accent-soft` fill, icon in `--accent`. Main content reserves `72px + space-6` bottom padding.
- **Rail** `.z-rail` (≥600px): 208px wide (236px ≥1024px), sticky under the top bar (`top: 60px; height: calc(100dvh - 60px)`), `--glass` + blur(14px), 1px right border. Vertical list, 4px gaps; links 46px min-height, radius 10px, icon 20px + label, `--text-2`, weight 500; hover and active get `--accent-soft`; active also gets a 3px rounded bar at the rail's left edge (`left: -12px`, gradient `--accent` → `--accent-2`) and an `--accent` icon. Main column: padding 32/24/40px, max-width 880px (1040px ≥1024px), centred.

---

## 7. Quality

### 7.1 Tests (`tests/`)
- **unit** — 69 spec files (+1 snapshot), ≈588 cases: `app-smoke`, `app-theme`, `backup`, `baseline`, `card-generation`, `cards-srs`, `coach-secrets`, `coach-service`, `coach/{checker,context,providers,rules}`, `codex/{acceptance,codex}`, `controller-glyph`, `data/{diff,importer,parse,repos,schemas,tags}`, `design/{contrast,enso-ring,frame-value,hit-level-chips,redesign}`, `diagnostics`, `engine/{adapt,gates,goldens,mastery,patch,plan,prng,punish,srs,stats,weakness}`, `integrity-quarantine`, `kpi-inputs`, `lab/{timer,verify}`, `match-import`, `matchups`, `media/{bundled,components,integrity,migrate-v4,pack,repo,subjects}`, `migrate`, `notation/{render-model,speak,tokenizer}`, `patch`, `perf`, `placement`, `progress`, `provider-contracts`, `punish-key`, `research/{migrate-v5,research}`, `resilience`, `seed-recovery`, `server/intel`, `services/siteAccess`, `snapshots-gzip`, `snapshots`. Some suites `describe.skipIf(!fakeAvailable)` (fake-indexeddb).
- **integration** — 9 files, ≈26 cases: baseline, codex, count-stepper-hold, error-boundary, lab, onboarding, path, sheet-focus, today.
- **e2e** (Playwright) — 19 specs + `helpers/png.ts`, ≈75 tests × phone/desktop: a11y-routes (axe on 19 routes), a11y, coach, codex, design (no cropped img, schemes), e2e-scripts-p12 (E1–E12 spec scripts), gallery, intel, lab-resume, log-matchups, media, onboarding, progress-patch-settings, punish-cards, pwa-resilience (first-load LCP test `test.skip` "QUARANTINED KI-002"), screenshots-p12, site-access, smoke, today-path. **No test exercises tab-bar/rail navigation or reachability.**
- Fixtures/goldens: `tests/fixtures/engine/G1–G10.json` ↔ `tests/golden/G*.expected.json`; `fixtures/patch/{old,new}-pack.json` + golden diff; `fixtures/wavu/*` (Cargo pages, revisions, live shape, TekkenDocs).
- Last local results (session logs in scratchpad): Vitest 78 files / 853 tests passed; full Playwright 265 passed, 1 flaky (E3 desktop "debrief shows mastery deltas"; artifact in `test-results/`; logged as open in `docs/ops/RCA_LOG.md`), 2 skipped.
- Vitest (`vitest.config.ts`): jsdom, coverage only over `src/domain/**` + `src/data/import/**`, thresholds lines/functions/statements 90, branches 85.

### 7.2 Lint and guards
- `eslint.config.js` (flat, typescript-eslint, react-hooks) + custom `eslint-rules/no-color-literals.js` (no hex/rgb/hsl string literals outside tokens) and `eslint-rules/no-direct-storage-fetch.js` (no `fetch`/indexedDB in `src/screens|components`).
- `scripts/check-no-colors.mjs` (no colour literals in CSS except tokens.css), `scripts/check-boundaries.mjs` (no Dexie/fetch in screens/components). Note: screens do import repos directly (allowed).
- `scripts/check-bundle.mjs`: shell (`index-*.js` only) ≤200 kB gz (now 62.3), each route chunk ≤80 kB gz (progress/charts ≤140; charts now 110.6), moves pack ≤150 kB gz (27.9). Not counted in "shell": `react` 44.9 + `data` 44.5 + `router` 8.1 kB gz, which also load at startup.
- `scripts/validate-data.ts` (schemas, tokenizer on every input/segment, references, duplicates, frame regexes, provenance).

### 7.3 CI (`.github/workflows/ci.yml`) and configs
- Triggers: push to `main`, every pull_request, monthly cron `17 9 1 * *`, workflow_dispatch (input `deploy`, default true). Runners pinned `ubuntu-24.04`, Node 22.
- Jobs: `quick` "Types, lint, unit tests, build" (typecheck, lint, vitest, validate:data, build, check-bundle) → `e2e` "Browser tests (phone and desktop)" (Playwright default config, then `playwright.netlify.config.ts`) and `media` "Bundled media from Wavu Wiki" (non-PR; Pillow; cached; uploads `site-media`) → `deploy` "Deploy to Netlify" (non-PR; downloads media, builds, checks dist, `netlify deploy --prod --dir=dist --functions=netlify/functions --no-build`; exits green without `NETLIFY_AUTH_TOKEN`/`NETLIFY_SITE_ID`; probes intel health).
- `.github/dependabot.yml`: weekly npm (grouped dev-tooling / runtime-minor) and GitHub Actions.
- Playwright: `playwright.config.ts` (phone = Pixel 7, desktop 1440×900, `vite preview` :4173, 1 worker, 1 retry); `playwright.netlify.config.ts` (`scripts/serve-dist.mjs` :4174 with real headers/redirects; smoke, media, pwa-resilience, today-path, site-access). Local-only wrappers `playwright.local.config.ts` / `playwright.netlify.local.config.ts` (git-excluded; the latter hard-codes an absolute path).

---

## 8. Docs and the spec

### 8.1 In repo
| File | One line |
|---|---|
| `CLAUDE.md` (M0) | Session entry point: read `docs/REFERENCE.md`; non-negotiables (the loop, storage/fetch/colour rules, PR-only shipping, RCA protocol). |
| `docs/REFERENCE.md` (M0) | Core concept, owner rules/secrets, locations (repo, Netlify site id, PC clone), architecture essentials, ship path, environment limits, RCA protocol + failure catalog, decisions. Points to `docs/ops/INVENTORY.md` and `docs/v2/PLAN.md` (**neither exists yet**). |
| `docs/ops/RCA_LOG.md` (M0) | Root-cause log, 7 entries 2026-10-30…11-01 (incl. the open E3 debrief flake). |
| `scripts/doctor.mjs` (M0, `npm run doctor`) | Release doctor: version agrees across package.json / `APP_VERSION` / docs, no scratch files in the repo. Its header says it "runs in CI after the build", but `ci.yml` does not call it yet. |
| `scripts/ci-failures.sh` (M0) | Prints failed check runs + annotations for a commit or PR via `gh api`. |
| `README.md` | Overview, stack, rules, commands, pipeline diagram, intelligence, branch protection, media, layout, version history 1.0.0–1.4.1. |
| `docs/AMENDMENT_01B_LOCAL_MEDIA.md` | 1.1.0 local media library (import packs/files, schema v4). |
| `docs/RELEASE_1.2.0.md` | Bundled media served by the site, CSP/caching headers, GitHub Actions → Netlify. |
| `docs/RELEASE_1.3.0.md` | Intelligence: ZANSHIN coach provider, Look it up, primers, patch briefs, spend cap, research table (v5). |
| `docs/RELEASE_1.4.0.md` | "Ink and steel" redesign: 4 schemes, scene, uncropped heroes, frame-data key; "For later" list. |
| `docs/RELEASE_1.4.1.md` | Expired SSO sign-in detection + immediate update fetch. |
| `docs/redesign/AUDIT.md` | 1.3 UX audit across 24 routes (crop measurements). |
| `docs/redesign/DESIGN.md` | Art direction and design system for 1.4 (schemes, scene, glass). |
| `qa/screenshots/{01B,P1,P4,P12}` | 112 PNGs (12/4/8/88) — **local only, git-excluded**. |

### 8.2 The original spec (not in the repo)
- Code cites `§x.y` throughout (most: §4.7 ×45, §5.10, §10.7, §10.13, §10, §6.3, §4.9, §9.1, §11.5…). The source is **`/tmp/claude-0/-home-claude/b013f20f-137b-5cab-8edd-e7c1a51292f7/scratchpad/ZANSHIN_SPEC.md`** ("ZANSHIN — Yoshimitsu Mastery App: Muse Build Reference & Runbook", Oct 29 2026, 2,611 lines, §0–§15 + Appendices A/B). Companion files there: `ZANSHIN_AMENDMENT_01_IMAGERY.md` (Amendment 1, Tekken imagery), `yoshi-research-notes.md` (pre-spec research). The spec told Muse to save it as `docs/ZANSHIN_SPEC.md` and keep STATUS.md, DECISIONS.md, BUILD_LOG.md, QA_REPORT.md, KNOWN_ISSUES.md, docs/SPEC_DEVIATIONS.md — **none of these are in the repo**, yet code cites `D-0xx` decisions, `KI-002`, `KNOWN_ISSUES.md` and "the build report".
- Core concept (spec §1): (1) ZANSHIN turns practice into a measured loop of assess → drill → play → review, every recommendation tied to Sagar's logged results. (2) A local-first app that says exactly what to practise today, measures whether it worked, and adapts, on current Tekken 8 Yoshimitsu data. (3) A Shu/Ha/Ri roadmap of 10 gated stages from controls to Tekken King, with placement so Tekken 7 skill can skip stages; leading skill signals over rank. (4) Short 20–45 min sessions on a phone/tablet beside the TV (Lab Mode), rest days healthy, consistency not streaks. (5) Candid coach that never invents frame data (Wavu Wiki is the source), no accounts/sync/game memory/BN-hosted media in v1.
- Spec §15.3 v2 backlog: encrypted sync; more characters; replay-timestamp notes with own clips; automatic matchup sheets from opponent packs; voice logging in Lab Mode; tournament prep; review reminders via web push.

---

## 9. Gaps, stubs and inconsistencies

### 9.1 Navigation and reachability (highest impact)
1. Phone users have no nav entry for Settings, Progress, Coach, Cards, Punish, Matchups, Playbook, Patch Watch or Diagnostics except Today's tiles/quick actions; the spec's "More" tab was never built.
2. `/codex/heat` has no inbound link; `/codex/stances` and its sheets are reachable only from each other; `/codex/combos` only via a combo detail's back link. The Codex tab lands on moves with no sub-nav.
3. `/patch` is reachable only from a Today notice shown after an update has already been applied — the first check has no entry point. `/diagnostics` has no link from Settings.
4. Broken coach citation link `/codex/move/…` (`CoachScreen.tsx:52`).
5. Tab label "Matches" (→ Match Log) vs quick action "Matchups" (→ roster) is easy to confuse; no tab is highlighted on most secondary routes.
6. `/dev/gallery` ships in production; "Mock (development)" provider is offered in production Settings.

### 9.2 Learning-engine fidelity (verify before building on it)
7. **Likely bug**: `services/lab.ts:144` `stageOpen: stageIndex === 0` writes `state: 'locked'` for every node outside Stage 0 on each recompute (sets, match logs, imports). Gates need ≥80% solid nodes, so Stages 1+ appear unable to pass through practice, and Path shows "Locked" under open stages. `prerequisitesMet: true` is hard-coded; prerequisites are only checked on NodeDetail. Not covered by any test.
8. Node mastery K is never fed: `cards: []` and no `punishQuizAccuracy` passed — flashcards and the punish quiz do not move node mastery (K stays null; score = E/A only). Node KPIs `verifiedShare`, `punishQuizAccuracy` have "no source yet".
9. Gate evidence is keyed by metric id (`services/stages.ts` `metrics[criterion.metric]`): several `drillSuccess` criteria in one gate (e.g. Stage 2 whiff-punish + sidestep) collapse into one pooled value over the stage's last N sets; "both sides" / "on 2 days" conditions in gate descriptions are not evaluated.
10. 16/50 nodes have no drills (cannot get E evidence or plan blocks); Stage 9 gate is empty.
11. §7.5 difficulty adaptation (`domain/engine/adapt.ts`), `plateauNote`, `matchupBriefText`, `kpiRollups`, `findingSentence`, `answerKeyTable` are implemented and tested but unwired.
12. Path "Test out" passes `testOut` and then ignores it (`void testOut;`); behaviour is the same gate session, evaluated with `testOutStageId` in the debrief. Debrief prints raw criterion ids (`failedCriteria.join(', ')`) where Path uses `criteriaText()`.
13. Patch Watch applies updates to the `packs` table, but Codex/Lab/Cards/Coach/Playbook read the bundled JSON — applied data updates are invisible in the Codex.

### 9.3 Half-built / flagged-off features
14. Online match import (Wank, ewgf) behind `FLAGS.matchImport = false`, adapters "UNVERIFIED"; Import screen tells the user to enable it "in Settings", which has no such control. CSV is the only working import.
15. Rank over time: permanent stub ("Rank history is not recorded yet"); rank is a single profile field.
16. TekkenDocs fallback importer exists but is CLI-only.
17. First-load LCP e2e budget quarantined (`test.skip`, KI-002).
18. Settings fields with no effect: `inAppImporterEnabled`, `matchImportEnabled`, `backupReminderDays`, `snapshotsKeptDaily/Event`; card caps have no UI. Feature `FLAGS` other than matchImport/inAppImporter/baseline are never read.
19. Spec layout features not built: two-pane tablet/desktop, bottom sheets for details (Sheet/Modal components exist, unused), 240px rail / 1200px content.

### 9.4 Dead code and stale text
20. Dead: `PlaceholderScreen.tsx`; 18 SVGs in `src/assets/`; `public/brand/seal-gate.svg`, `wordmark.svg`; gallery-only components (Sheet, Modal, StatTile, ProgressLine, MatchupCard, PatchBanner; EmptyState via placeholder only). `todayIso()` duplicated in `app/plan.ts` and `app/planState.ts`.
21. Stale comments/copy: `config/flags.ts` ("false until P7…"), `app/planState.ts` ("Until P7/P8…empty"), `services/stages.ts:264` ("0 until P8"), `services/cards.ts` reviewCaps note ("seeded settings row stores reviewsPerDay 20" — bootstrap stores 60), Diagnostics Safe Mode text ("arrives in a later phase"), `screens/diagnostics/DiagnosticsScreen.tsx` header ("lands in P11"), `screens/settings/MediaScreen.tsx` header ("the app never downloads media" — untrue since 1.2.0), `docs/RELEASE_1.2.0.md` CSP claim (outbound only to site/Wavu/coach) vs actual `connect-src https:`.
22. Two metric-id vocabularies (`metricIdSchema` vs `weaknessMetricIdSchema`, schemas.ts:123–140) with differing spellings.
23. ~11 screens render their own `<main>` inside the shell's `<main className="z-main">` (nested landmarks), and several also render a `PageHeader level={1}` under the top bar's `<h1>` (Coach, Cards, Punish, Playbook, Log list).
24. `APP_VERSION` is hard-coded in `services/backup.ts` separately from `package.json` (Vite reads package.json only for `/version.json`); PWA `theme_color` #0E0F11 differs from the scheme backgrounds.
25. Spec working files (DECISIONS.md, KNOWN_ISSUES.md, docs/ZANSHIN_SPEC.md…) are referenced from code but absent from the repo; `docs/REFERENCE.md` now points at `docs/ops/INVENTORY.md` and `docs/v2/PLAN.md`, which do not exist yet (this file is the natural candidate for the former).
26. `docs/REFERENCE.md` §4 says domain code is pure, but `src/domain/coach/providers/*.ts` perform `fetch` (injectable, but network code inside `src/domain`). Its "Current version" line still names main `f4d858f`.
