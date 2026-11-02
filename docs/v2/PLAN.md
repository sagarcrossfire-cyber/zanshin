# ZANSHIN 2.0 — engineering plan

Sagar's copy (prose, for reading and comments): Claude Doc "ZANSHIN 2.0 — Plan",
https://claude.ai/artifact/Mdq1Rc4FM8MWZUQj8fWTvk. This file is the build contract: scope, order, acceptance
criteria. Research behind it: `docs/v2/research/` (design.md = IA, nav spec, imagery; coach-intel.md = curriculum
gaps, ranked data sources, models, features F1–F12; infra.md = credits, sync, jobs, telemetry, CI). The 1.4.1 map
is `docs/ops/INVENTORY.md`. Rules and the release path: `docs/REFERENCE.md`.

Inputs from Sagar (2026-11-01): uses **PC and phone** (sync is required) · plays on **PS5** · AI budget about
**$25/month** · enters his own Tekken ID in Settings · build autonomously, ask only for credentials, money or a
real either-way decision. Netlify Free plan: **117.5/300 credits left until 2026-11-29**, so **three production
deploys** for 2.0 (45 credits); everything else is reviewed on free PR previews.

Open decision (asked 2026-11-01, section 9 of the doc): **one-hour SSO** — A keep private + one-tap reconnect, or
B public shell + device-key-locked functions (recommended). Until answered, build so both work: every function
call carries the device key; reconnect UX handles 401.

## Releases

| Release | Version | Milestones | Production deploys |
| --- | --- | --- | --- |
| 1 | 2.0.0-beta.1 | M0 M1 M2 M3 | 1 |
| 2 | 2.0.0-beta.2 | M4 M5 M6 | 1 |
| 3 | 2.0.0 | M7 M8 | 1 |

Milestones merge to `main` without a version bump (no deploy); the release PR bumps `package.json`,
`APP_VERSION`, README, `docs/RELEASE_<v>.md`, `docs/REFERENCE.md` (doctor enforces it).

## Gate for every milestone

`verify:quick` + build + bundle + doctor green · new unit/e2e tests for what it adds · full e2e green in CI (phone,
desktop, Netlify headers) · no cropped art, AA in all four schemes (existing tests) · independent QA agent review for
user-facing milestones (blockers fixed) · REFERENCE + RCA_LOG + INVENTORY updated · preview URL noted in the PR.

## M0 Foundations (PR #17)

Release gate + free previews (CI), REFERENCE.md, CLAUDE.md, RCA_LOG, INVENTORY, doctor, ci-failures.sh.
Accept: a docs-only merge to `main` logs "version unchanged … no production deploy"; a PR gets a `Preview` notice.

## M1 Shell, navigation, fixes, telemetry

- **IA (design.md §B.1, Option A):** hubs Today · Train (Lab, Punish, Flashcards, Baseline) · Coach (centre:
  Ask, Weekly review, Debriefs, Look it up as `/coach/ask|review|debriefs|research`, old `/coach` redirects) ·
  Study (Codex moves/stances/combos/heat, Matchups, Playbook, Patch Watch) · You (Path, Matches, Progress, Settings,
  Diagnostics). No existing URL changes. One pure `hubFor(pathname)` drives every highlight; unit-test all routes.
- Per-hub memory (sessionStorage, try/catch); re-tap active hub → hub root + scroll top.
- Phone: floating glass dock with safe areas, Coach in a brush-circle ring; sub-nav chip row per hub; session
  accessory pill when a session is unfinished. Tablet: 80 px rail. Desktop: 248 px scroll-style rail tree,
  collapsible to 72 px (`[`), remembered. Spec: design.md §C (derived tokens only, no new colours).
- Command palette (Ctrl/Cmd+K, `/`, phone search button): Continue · Recent · Actions · Go to; lazy content index
  (moves by name and notation, stances by abbreviation, combos, characters, nodes, playbook, log); fallbacks Ask
  the coach / Look it up. Disabled in Lab Mode and text fields. ARIA combobox/listbox; focus trap.
- Lab Mode: dedicated `.z-labstrip` (block, timer, press-and-hold Exit); no nav, palette or shortcuts.
- "Ask the coach about this" on move detail, character page, log detail, session debrief → `/coach/ask` with context.
- Badges: Train = due cards count; Coach/Study/You = dot; accessible names include them.
- Today quick actions shrink to Log a match set · Free practice · Ask the coach.
- Fixes: **stage lock** (`services/lab.ts` `stageOpen: stageIndex === 0` → real stage state; regression test that a
  Stage 1 node practised after Stage 0 passes is not saved `locked`); Coach citation chips `/codex/move/…` →
  `/codex/moves/…`; Heat and Stances reachable; Patch Watch reachable before an update; Japanese font subset for
  ensō/seal kanji; top-bar title weight; per-scheme `theme-color`; Workbox globs include `avif,webp`.
- Telemetry (infra.md §4): `netlify/functions/diag.mts` (`/api/diag`, POST, Zod, rate limit, `ZT1` log line,
  Blobs `diag-<context>` with daily cap); client queue in `errorReport.ts` (sendBeacon, dedupe by fingerprint,
  Settings toggle, sanitized, no IndexedDB content, no keys); intel writes one `ZT1` line per call (route, status,
  latency, model, cost, cap state — never prompt or answer); boot self-test event after each update.
- Intel fixes: spend ledger one key per call (`onlyIfNew`) summed by prefix; timeout 9 s → 45 s; retired Perplexity
  model ids → `effort` levels.
- Accept: every route reachable within 2 taps from any hub on phone; palette finds "flash", "KIN", "Kazuya",
  "log"; axe clean; e2e for dock, rail collapse, palette, Lab strip; Stage-1 regression test; diag function unit
  tests; no cropped art.

## M2 Ranked Sync (F1, F6)

- Settings: Tekken ID (+ optional platform label). Server: `netlify/functions/ranked.mts` fetches Wank
  `/player/<undashed id>` (HTML parse) and `/api/replays` windows (one request at a time, ≥ polite delay), ewgf
  `/external/battles/<id>` as fallback when `EWGF_API_KEY` is set; Blobs cache; returns normalized battles.
- Client: import into `matchSets` (dedupe `importRef = battle_at:p1:p2`), grouped into sessions; rank + rating
  trend on Progress; rank milestones vs Path stages (coach-intel.md §1.5); replace the broken 1.4.1 adapter;
  remove `FLAGS.matchImport` copy that points at a missing setting.
- Ranked session protocol: pre-queue focus, stop-loss (3 straight losses or −N), reset prompt, end reflection,
  Season 3 rules sheet.
- Accept: fixture-driven parser tests (saved Wank HTML + replay JSON), dedupe idempotent, e2e import with mocked
  function, protocol unit tests.

## M3 Device sync

- Encrypted per-device op log in Blobs (infra.md §2): `netlify/functions/sync.mts` (`/api/sync/*`), store scoped
  by deploy context, device key header verified against `v1/verifier`; AES-GCM, HKDF from a pairing secret shown
  as a code/QR; HLC per record; append-only tables union by id; mutable tables LWW; mastery recomputed after merge;
  schema v6 `syncOutbox` + `syncMeta` written by repositories only; pre-migration snapshot (existing guard).
- Sync on open, focus, online, debounced after writes; queue on 401 and resume after sign-in.
- Accept: two-device merge tests (fake IndexedDB), tombstones, clock skew, idempotent replays, migration v5→v6
  test, e2e pairing with mocked function; nothing secret leaves the device unencrypted.
- **Release 1: 2.0.0-beta.1** (release PR, production deploy 1/3).

## M4 Review loop, matchup queue, Curriculum 2.0 (F2, F3, F9, F12)

- Review from Stage 0–1 (`n8-review` moved), 4-tap moment template → problem move → drill + card → watch later
  matches. Matchup queue by exposure × losses (+ monthly CI sample of rank-band character frequency); opponent
  sheets from Wavu Cargo (launch-punishable, −10…−14 with his punisher, punishable lows, plus-frame, homing, power
  crush, string gaps). Curriculum nodes: neutral/sansukumi, low parry + follow-up, wall escape, conditioning,
  health economy; Practice-mode settings per drill. Flashcards + punish quiz feed mastery K (inventory gap).
  Patch Watch's stored update becomes the data the screens read (inventory gap). Patch-aware verify blocks.

## M5 Recognition trainer, voice coach (F4, F5)

- Recognition: opponent move clips (media pack `--opponents`), randomized, answer set (block low/mid, duck, step
  L/R, punish with …), accuracy + reaction time per move/character → weakness engine.
- Voice: Web Speech synthesis cues in Lab Mode; SpeechRecognition "hit/miss/next/undo" with restart on end; large
  buttons stay; Settings toggles; ElevenLabs pack only with Sagar's approval.

## M6 Imagery

- CI art pipeline (sandbox cannot reach Unsplash): `scripts/make_art_pack.py` downloads the approved Unsplash list
  (design.md §D.3), outputs grayscale AVIF+WebP at 800/1600 w into `public/art/`, credits into
  `src/data/art-credits.json`; a workflow on `art/**` branches pushes a contact sheet so Claude can review images
  by eye before use. Hub halls (`.z-hall`), Path stage landscapes, empty states, washi card faces, SVG ornaments
  (design.md §D.5); art budget ≤ 1.5 MB precached in `check-bundle.mjs`; Settings › Credits.
- **Release 2: 2.0.0-beta.2** (production deploy 2/3).

## M7 Intelligence (F7, F10, morning brief)

- Weekly plan: Sonnet 5.5 with JSON schema → typed plan Today can accept/edit. Review assistant (Haiku + opponent
  moves). Morning brief: scheduled function (UTC cron) writes the public half to Blobs; personal half generated
  on device. Study queue (Sonar). Coach context gains ranked results + problem moves. Contextual Ask everywhere.
- Accept: schema-validated outputs with fallbacks; spend stays under the cap; every AI number checked by
  `checker.ts`.

## M8 Independent QA and 2.0.0

Fresh-eyes agent: every route × phone/desktop × four schemes, crops, overflow, contrast, axe, offline, Lab Mode,
palette, sync pairing, ranked import; performance budgets; blockers fixed. **Release 3: 2.0.0** (deploy 3/3).

## Later (not 2.0)

Results-screen photo reading and clip coach (vision path untested; may need AI Gateway credits), semantic Codex
search (needs a CI secret), ElevenLabs cue pack, Mobbin-backed design review (paid plan).
