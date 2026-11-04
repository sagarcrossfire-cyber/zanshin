# ZANSHIN — Reference (read this first)

The single document a Claude session needs before touching this project. It exists to stop context drift
across sessions and compactions. **Order of truth: the code > this file > memory/summaries.** When they
disagree, fix this file in the same PR.

- Update this file in every release PR (version line, sections touched, new failure modes).
- The plan for the current major version lives in `docs/v2/PLAN.md`. The failure log is in `docs/ops/RCA_LOG.md`.
- A copy of this file is kept in the claude.ai Project "Tekken" (`claude/REFERENCE.md`). Refresh it with
  `Projects` → `project_write` (`local_path`) after each release.

Current version: **2.0.0-beta.1** (Release 1 of 2.0: M0–M3; main `2d824d8` at the release PR). Next: **2.0.0-beta.2** (M4–M6, see `docs/v2/PLAN.md`).

---

## 1. Core concept (never drift from this)

- **One player, one goal.** Sagar's private coaching app for mastering **Yoshimitsu in Tekken 8**, from the basics
  ("zero to hero"). He returned to Tekken 8 as a beginner after playing Yoshimitsu seriously years ago. Not
  published, no other users, never multi-tenant.
- **Local-first and private.** Data lives in IndexedDB on his devices and works offline. The site is a private
  Netlify project behind team SSO. 2.0 adds sync between his PC and phone, but local stays the source of truth.
- **Honest data.** Frame data comes from Wavu Wiki and carries a status (verified / unverified / conflicting). AI
  answers cite sources. Never invent frame data.
- **One loop.** Path (curriculum) → Today (daily plan) → train (Lab, Punish, Flashcards) → Match Log → Progress →
  the plan adapts. Every new feature must plug into this loop, not sit beside it.
- **Look.** "Ink and steel": Japanese ink/lacquer, four schemes (Manji Night default, Crimson Dojo, Heat Surge,
  Washi Daylight). Sagar likes the colour schemes — keep them. No cropped art. AA contrast everywhere.

## 2. Owner, rules of engagement, secrets

- Owner: Sagar (GitHub `sagarcrossfire-cyber`, email sagar.crossfire@gmail.com). Timezone America/Chicago.
- He wants autonomy: plan, build, test, ship without asking, except for credentials, money, or irreversible
  choices that could reasonably go either way. Hosting sign-ins belong to him: **never ask for passwords or
  tokens in chat.**
- The Perplexity key lives only in the Netlify env var `PERPLEXITY_API_KEY`. Never commit it (the repo is
  public), never store it in memory or docs. `INTEL_DAILY_CAP_USD=3`.
- AI budget for 2.0: about **$25/month** total (his answer, 2026-11-01). Devices: **PC and phone** (sync is a
  must). Plays on **PlayStation 5**. He enters his own Tekken ID in Settings; don't ask for it.
- Commit trailers (every commit):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: <session URL>`. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
  a blank line, then the session URL.

## 3. Where things are

| Thing | Value |
| --- | --- |
| Repo | `sagarcrossfire-cyber/zanshin` (public), `main` protected by the "Protect main" ruleset (PR + green checks) |
| Sandbox clone | `/home/claude/work/zanshin` |
| Sagar's PC clone | `D:\RUDRA\zanshin` (device bash: `$HOME/mnt/RUDRA/zanshin`) |
| Netlify site | `glistening-conkies-c028b3` · id `a72c64e3-9ba6-4ebe-9b66-57509c1fc41a` · https://glistening-conkies-c028b3.netlify.app |
| Access | Team SSO login required for every request (incl. `sw.js`, functions). The sandbox and PC cannot open the site. |
| Functions | `netlify/functions/intel.mts` → `/.netlify/functions/intel/*` (health, usage, research, …), spend in Netlify Blobs · `netlify/functions/diag.mts` → `/api/diag` (telemetry, §6) · `netlify/functions/ranked.mts` → `/api/ranked` (Wank/ewgf ranked games, device-key locked, §8) · `netlify/functions/sync.mts` → `/api/sync/*` (encrypted per-device op log in Blobs, `X-Zanshin-Sync` auth key verified against the stored verifier — a separate key from the device-key lock, §8). **All of `intel`, `diag` and `ranked` are locked to paired devices** (`src/server/deviceKey.ts`); sync pairing registers the device-key hash itself, so `ZANSHIN_DEVICE_KEY_SHA256` is optional (§6, §8). |
| CI | `.github/workflows/ci.yml`: `gate` (release gate) · `quick` (types, lint, unit, build, bundle, doctor) → `e2e` (phone+desktop, then Netlify-headers run) · `media` (`scripts/make_zanshin_media_pack.py`: Wavu Wiki icons, portraits, clips; a miss triggers a logged wiki art search, then — portraits only — the official site's transparent `img_01.png` render, trimmed to the figure; `.github/workflows/art-discovery.yml` on `art/**` branches is the log-only, contact-sheet way to vet a new source by eye) → `deploy` (production, only when the gate says so) · `preview` (every same-repo PR, alias `pr-<n>`); monthly cron `17 9 1 * *`. `e2e`'s `tablet` Playwright project runs only layout/regression specs (`playwright.config.ts` `testMatch`) — 820px is where the phone dock switches to the rail, and a third full pass of every behaviour spec buys nothing but job time. |
| Netlify plan | Team "Sagar Patel's team" (`6ae4a3d7e593b12138d36fad`), **Free credit plan: 300 credits/month hard cap, site pauses at 0**. Production deploy = 15 credits; previews 0; bandwidth 20/GB; requests 2/10k; compute 10/GB-h. Usage is only visible on the Netlify Usage page (Sagar). |
| 2.0 plan (for Sagar) | Claude Doc "ZANSHIN 2.0 — Plan": https://claude.ai/artifact/Mdq1Rc4FM8MWZUQj8fWTvk |
| claude.ai Project | "Tekken" (memory writes must go under `/projects/01a195bb-5c3d-73d6-a035-8788605b42bd/`) |

## 4. Architecture

See `docs/ops/INVENTORY.md` for the full map (routes, modules, tables, tests). Essentials:

- React 18 + Vite 6 + TypeScript strict, Zustand stores, Dexie (IndexedDB, schema v5), Zod schemas,
  vite-plugin-pwa (generateSW, `registerType: 'prompt'`, manual registration in `src/main.tsx`), Vitest, Playwright, axe-core.
- **Rules enforced by lint/scripts:** only repositories touch IndexedDB; screens never call `fetch` (services do);
  no colour literals outside `src/styles/tokens.css` (`check-no-colors.mjs` + ESLint `no-color-literals`, which also
  matches `#hex`/`rgb`/`hsl` inside TS strings); domain code (`src/domain`) is pure and ≥ 90 % covered; module
  boundaries via `check-boundaries.mjs`; bundle budgets via `check-bundle.mjs` (shell ≤ 200 kB gz).
- Schemes: `data-theme` (dark/light) + `data-scheme` (manji/crimson/heat) on `<html>`; every scheme is unit-tested
  for WCAG AA on every text and signal colour (`tests/unit/design/contrast.spec.ts`).
- "No cropped image" is an e2e rule (`tests/e2e/design.spec.ts`); ambient blurred copies carry `data-ambient`.
- **Navigation (2.0):** `src/app/hubs.ts` is the single map of routes → five hubs (Today · Train · Coach · Study ·
  You) → sections (→ Codex views). The dock (phone), rail (tablet/desktop, collapsible with `[`), section chips,
  top-bar eyebrow and the Ctrl/Cmd+K palette (`src/app/paletteIndex.ts`, lazy `CommandPalette`) all read it; a new
  screen needs one entry there (and a test row in `tests/unit/nav/hubs.spec.ts`). Hub memory in sessionStorage
  (`navMemory.ts`). Coach sections are routes (`/coach/ask|review|debriefs|research`; `/coach` → Ask;
  `?about=` pre-fills a question — `AskCoachLink`). Lab Mode renders only `LabStrip` (hold or press twice to exit).
  Nav colours are the derived `--nav-*` tokens.
- Kanji render from a 5 kB subset font ("Zanshin Kanji", `scripts/subset-kanji.py`); a unit test fails if `src/`
  uses a kanji the subset lacks.
- Move of the day (2.0 M6): Today plays one Yoshimitsu clip (`src/components/media/MoveOfTheDay.tsx`, pick in `src/domain/media/moveOfTheDay.ts`): the first of today's drills' Codex moves with a clip, else a daily rotation; absent without clips. Clips autoplay muted/looped at ≥ 50 % visible, pause off-screen and in a background tab, never under reduced motion or with Settings › Images and clips › autoplay off.
- Motion (2.0 M6): `.z-stagger` / `data-motion="stagger"` (`src/styles/base.css`) brings children in one after another — transform only (never opacity: axe samples mid-fade), 40 ms apart, capped at the 12th; used on Today, the Match Log, the roster and the deck grid. Roster figures step forward on hover/focus. Every motion has a `prefers-reduced-motion` off-switch (the global rule shortens durations but keeps delays, so stagger turns off outright); `tests/e2e/motion-regressions.spec.ts`.
- Hub halls (2.0 M6): `PageHeader` stands in its hub's hall (`src/components/layout/HallArt.tsx`, styles in `HallArt.css` so they load wherever a hall renders); screens with their own header (Matchups, Moves, Path) use `useHubHall()` (`hallClass` on the header, `hallArt` as its first child): seeded ink ridges, a hub motif (torii, bamboo, moon, brush, hanko) and the hub kanji, original SVG, tokens only, aria-hidden. Ridges drift with scroll via one passive rAF listener writing `--hall-scroll` (off under reduced motion); `--scene-art-opacity` drives them, so reduced transparency hides them; phones keep only the ridges. Kanji in source must be in the font subset (`kanji-subset.spec.ts`).
- Path stage landscapes (2.0 M6): each stage card carries `StageLandscape` (`src/components/decor/StageLandscape.tsx`), a ridge strip behind its title that rises with the stage (foothills → mist → shrine → peaks → moon over water, `stageScene`), accent-tinted when open, grayscale when locked, with a seal sun once passed. A passed stage's hanko shows its numeral 一–十 (`Hanko glyph`). Marks hide on phones; `--scene-art-opacity` drives it. New kanji means rerunning `scripts/subset-kanji.py`.
- Empty states (2.0 M6): `EmptyNote scene=…` (`src/components/decor/EmptyArt.tsx`) puts a small original ink drawing beside the empty line: lantern (Matches), dojo floor (Coach debriefs), moon over water (Coach reviews), washi (Cards), raked gravel (node mastery chart). Aria-hidden SVG, tokens only; the lantern sways and the ripples drift (transform only, off under reduced motion). Use it for any new empty state.
- Flashcard face (2.0 M6): `.z-cards__face` on the review card: Washi Daylight shows kozo fibres (`--pattern-washi`) and grain, multiply at 6.5 %; dark schemes a lacquer sheen (`--face-sheen`) and grain, soft-light. The texture is a `::after` at z-index −1 inside the isolated card, so content and contrast are untouched; the back rises in on reveal (off under reduced motion).
- Hall photos (2.0 M6): behind the ridges, when Show art is on, a grayscale Unsplash photo per hub (`public/art/<hall>-{800,1600}.{avif,webp}`, credits and focal points in `src/data/art-credits.json`, shown in Settings › Images and clips › Credits). Heat (coals, tinted with the Heat colours) and Punish Trainer (blade) are section halls with their own photo (`section` in the credit; `hallPhotoFor` falls back to the hub's). Blend, opacity and filter are tokens (`--hall-photo-*`: dark luminosity and darkened, light multiply and lifted) so text keeps AA; the photo is masked right of the text column and rises from the bottom on phones. `image-set(type())` is gated by `@supports` (a var() the engine can't parse does not fall back to the previous declaration). The 800 px set is precached; `art/*-1600.*` is excluded and served stale-while-revalidate from cache `zanshin-art`. `check-bundle` budgets all art at 1.5 MB and the 800 px set at 400 kB. Re-make the pack with the Art review workflow (`scripts/art/make_art_pack.py`, picks in `scripts/art/picks.json`), never by hand.
- Updates: `version.json` (build-emitted, not precached, `no-store`) is probed by `src/services/siteAccess.ts`;
  401/403 → "Sign in again" banner; another version → `registration.update()`. A waiting update on a page nobody
  has touched yet (no pointer, key or touch) and with no Lab session is applied and reloaded at once, at most once a
  minute, so a plain reload lands on the new release; otherwise the "Update available, reload" toast, which never
  interrupts a Lab session (`src/services/updateGate.ts`).

## 5. How to ship (the only path to production)

1. Branch from `main` (`git checkout -b <topic>`). Keep scratch files **outside** the repo (the scratchpad), or ESLint fails.
2. Before pushing: `npm run verify:quick` (typecheck + lint + unit) and `npm run build && node scripts/check-bundle.mjs`.
   Targeted e2e locally: `npx playwright test -c playwright.local.config.ts <spec> --retries=0`
   (the local configs point at `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`; they are git-excluded).
   The full local e2e suite takes ~25 min; let CI run it in parallel instead of waiting.
3. Push, then open the PR with the REST API (GraphQL `gh pr create` is blocked):
   `gh api -X POST repos/sagarcrossfire-cyber/zanshin/pulls -f title=… -f head=<branch> -f base=main -F body=@<file>`.
4. Watch checks with a Monitor loop on `repos/…/commits/<sha>/check-runs` (emit completed runs; stop when none
   are queued/in_progress). Deploy is skipped on PRs (expected).
5. On failure: **RCA protocol (section 7)**. Read failures with
   `gh api repos/sagarcrossfire-cyber/zanshin/check-runs/<id>/annotations` (Actions logs and artifacts are blocked).
6. Squash-merge: `gh api -X PUT repos/…/pulls/<n>/merge -f merge_method=squash -f commit_title="… (#n)"`.
7. **Production deploys cost credits, so they happen only on a release.** The `gate` job deploys production when
   `package.json`'s version changed in the push, on a manual run with `deploy`, with `[deploy]` in the commit message,
   or on the monthly media refresh when the media files changed. Every other merge to `main` runs the tests and
   stops. Each PR gets a free preview at `https://pr-<n>--glistening-conkies-c028b3.netlify.app` (behind the same
   login); its URL is a `Preview` notice in the check-run annotations. Batch work into releases; never bump the
   version just to see a change live — use the preview.
8. After a release merge, watch the `main` run through `Deploy to Netlify`, then verify: Netlify MCP `get-project` (current deploy id) →
   `get-deploy-for-site` (published, header/redirect rule counts) → `get-request-logs` (live requests, e.g.
   `/version.json` 200). The site itself cannot be opened from here.
9. Update this file, `README.md` (versions list), `docs/RELEASE_<v>.md`, `package.json` + `APP_VERSION`
   (`src/services/backup.ts`) — `scripts/doctor.mjs` checks they agree.

## 6. Environment facts and limits

- The sandbox proxy blocks: closing/reopening PRs, rulesets, repo secrets, Actions logs and artifacts, GraphQL
  PR creation. Check-run annotations work.
- Neither the sandbox nor Sagar's PC shell can reach `api.perplexity.ai` or the SSO-protected site; verify live
  behaviour through Netlify request/function logs.
- Netlify routing: `/media/*` misses answer 404; **every other unknown path answers `index.html` with 200** —
  never treat a 200 as proof a file exists (check content/format).
- vite-plugin-pwa `registerSW` does not re-fetch `sw.js` for an existing registration; browsers check on
  navigation. A browser whose Netlify SSO session expired gets 401 for everything while the SW serves the old
  shell (incident 2026-11-01).
- Netlify credits, from Sagar's Usage page on 2026-11-01 13:39 UTC: **117.5 / 300 left**, cycle Oct 29 → Nov 29
  2026. Spent: production deploys 180 (12 × 15), web requests 0.7 (3,638), compute < 1, bandwidth 1.7, **AI
  inference 0** (the intel function calls Perplexity's Agent API with Sagar's own key, never Netlify's AI Gateway).
  The release gate (2026-11-01) stops per-merge deploys; budget ≤ 3 production deploys per cycle for 2.0. Sagar
  stays on Free unless he says otherwise; Personal ($9/month, 1,000 credits, auto top-up) is the fallback. Avoid
  credit-hungry features (Netlify AI Gateway, Netlify DB). Ask Sagar once to confirm that `--alias` preview
  deploys show 0 credits on the Usage page.
- Blobs stores are site-wide and shared by previews and production: anything a preview writes (sync, telemetry)
  must use a store name scoped by `context.deploy.context`.
- Scheduled functions run only on the published production deploy, in UTC, with a 30 s limit. Synchronous
  functions have 60 s: `intel` gives Perplexity 45 s and the browser waits 50 s.
- Housekeeping still open: PRs #9, #11, #12 (stale, cannot be closed through the proxy — Sagar can close them),
  #13 Dependabot.

### Telemetry (2.0 M1)

- **What is sent.** `src/services/errorReport.ts` turns every recorded error into one sanitized event
  (schema shared with the server: `src/server/diag/schema.ts`; kinds error, unhandledrejection, sw, idb, quota,
  intel, sync, boot-selftest, perf), one per fingerprint per session, by `sendBeacon` to `POST /api/diag`
  (`netlify/functions/diag.mts`, rate limit 60/min). Never notes, match logs, coach text, keys or IP. Off switch:
  Settings → Data "Send error reports…" (`settings.telemetry`, default on, mirrored in localStorage
  `zanshin.telemetry`). Only from the site: on localhost (dev, preview, e2e) nothing is posted.
- **Boot self-test.** The first open of each release in a browser posts `boot-selftest` with `checks.intel`
  (ok · no-key · no-blobs · signed-out · offline · missing · error) and `checks.idbOpenMs`. No self-test line after a
  release means no signed-in browser has opened it yet (look for 401s on `/sw.js`).
- **The lines.** `diag` logs `ZT1 {event}` per accepted event. `intel` logs one
  `ZT1 {"src":"intel","route","method","status","latencyMs","model","costUsd","cacheHit","capState","requestId"}` per
  request (capState ok · near ≥ 80 % · reached · off); never the prompt or the answer.
- **Read them** with the Netlify observability connector (`netlify-observability-services-reader`):
  `get-request-logs` with `siteId` `a72c64e3-9ba6-4ebe-9b66-57509c1fc41a`, `from_ts`/`to_ts` in ms (24 h window on
  Free), and filters `[{"field":"FunctionName","op":"=","value":"diag"}]` (or `intel`) and/or
  `[{"field":"LogText","op":"=","value":"ZT1"}]`. Each request's `logs[]` holds the line; parse the JSON after
  `ZT1 `. `get-request-detail` (request id, a window around it) adds UA class, geo and timings.
- **Past 24 h.** Events are also kept in Blobs: store `diag` (production) or `diag-<deploy context>` (previews),
  keys `<YYYY-MM-DD>/<ts>-<rand>`, at most about 500 a day. There is no Blobs reader in the connector yet; the
  planned nightly digest will re-log a 7-day summary as a `ZT1` line.
- **Spend ledger.** The `intel` store keeps one key per paid call, `usage/<day>/<requestId>~c<µUSD>~i<in>~o<out>`,
  written with `onlyIfNew` and totalled by `list({prefix})`; the 1.3 single `usage/<day>` key is still read and added.

### Ranked Sync, server side (2.0 M2)

- **What it does.** `GET /api/ranked?id=<Tekken ID>[&since=<ISO>]` (`netlify/functions/ranked.mts` →
  `src/server/ranked/handler.ts`) reads Sagar's ranked games from Wavu Wank (`wank.wavu.wiki/player/<undashed id>`,
  HTML parsed by `src/server/ranked/wankPage.ts`), optionally enriches the newest battles with in-game ranks from
  at most 3 `/api/replays?before=<unix>` windows (`src/server/ranked/replays.ts`, strictly sequential, ≥ 1 s apart,
  descriptive User-Agent), and falls back to ewgf.gg (`src/server/ranked/ewgf.ts`) only when Wank fails and
  `EWGF_API_KEY` is set. Results are normalised battles (`src/server/ranked/schema.ts`) cached per id for 10
  minutes in Netlify Blobs (store name from `src/server/storeName.ts`: `ranked` in production, `ranked-<context>`
  elsewhere). The Tekken 8 rank ladder is a small bundled pack (`src/data/packs/ranks.json`, pure helpers in
  `src/domain/ranked/ranks.ts`), kept out of `src/data/packs/index.ts` so the function does not bundle the moves data.
- **Device-key lock (SSO Option B, §8 decisions).** Every request passes `src/server/deviceKey.ts`: header
  `X-Zanshin-Device`, SHA-256'd and compared against the allow-list `allowedDeviceKeyHashes()` builds — the
  comma-separated hashes in env `ZANSHIN_DEVICE_KEY_SHA256` (optional, one hash per paired device) union the one
  hash sync pairing registers in the sync store (`v1/devicekeyhash`, write-once — see "Device sync, server side"
  below). A fresh site needs no manual hash step or extra deploy: pairing alone unlocks `ranked`, `intel` and
  `diag` for every paired device. With neither an env hash nor a registered one, the function fails closed (503
  `device-key-unset`). A wrong or missing key is 401 `device-key`. The raw key never reaches logs, Blobs or
  error text. `intel.mts` and `diag.mts` use the exact same helper and return the same JSON shape
  (`{ok:false, code, error}`) for both statuses; `sync` keeps its own `X-Zanshin-Sync` auth (below), unchanged.
- **Client storage.** The paired device's key lives in `localStorage` only (`zanshin.deviceKey`,
  `src/services/deviceKey.ts`), one key per browser/device — never in IndexedDB, so it can never be swept into a
  backup export, a future device-sync payload or an error report.
- **Env vars.** `ZANSHIN_DEVICE_KEY_SHA256` (now optional — sync pairing registers a device's hash itself; set
  it only to add a device-key hash outside of pairing) · `EWGF_API_KEY`
  (optional; without it the ewgf.gg fallback is simply off and a Wank failure is the final answer).
- **Fixtures.** `tests/fixtures/ranked/player.html` and `replays-window.json` are REAL captures (one GitHub Actions
  run, 2026-11-01, workflow deleted after use; `capture.json` records how), so the parser tests
  (`tests/unit/server/ranked.spec.ts`) run against the actual page shape instead of a hand-written approximation.
- **Logging.** One `ZT1` line per request via `src/server/diag/zt1.ts` (route, status, latencyMs, battles,
  cacheHit, source); the Tekken ID is never logged, only `idHash` (first 10 hex chars of its SHA-256).

### Device sync, server side (2.0 M3)

- **What it does.** `netlify/functions/sync.mts` → `/api/sync/*` (`rateLimit` ≈120/min, `consistency: 'strong'`)
  is the encrypted per-device operation log from `docs/v2/research/infra.md` §2. Logic is in
  `src/server/sync/{handler,schema}.ts`; the function file only wires Blobs (store name from
  `src/server/storeName.ts`: `sync` in production, `sync-<context>` elsewhere). The server only ever stores
  ciphertext — every `log`/`snap` body is an opaque `v1.<iv>.<ct>` string from the client; nothing here decrypts,
  reads or interprets it.
- **Routes:** `POST init` {verifier, deviceKeyHash?} (no auth — first device pairing, `onlyIfNew` so a second pairing attempt gets
  200/409 instead of clobbering; `deviceKeyHash` — SHA-256(deviceKey) — is stored `onlyIfNew` at `v1/devicekeyhash`
  in the same request, write-once, so pairing registers the device-key lock with no manual step, §8 SSO Option B)
  · `GET state` (auth-exempt only while unpaired) → `{hasVerifier, devices:
  [{deviceId, acked}], latestSnap?: {hlc, cursor}}` · `PUT log/<deviceId>/<hlc>` (`onlyIfNew`, ≤1 MB opaque
  ciphertext) · `GET log?device=<writerId>&after=<hlc>&limit=` → that writer's own entries, ascending, paged under
  a 5 MB response budget, `next` is an hlc to resume with `after` · `PUT snap/<hlc>` body JSON `{cursor, data}`
  ≤5 MB total (`onlyIfNew`, then prunes to the newest 3, deleting each stale snapshot's `snapmeta` too) · `POST
  ack` {deviceId, through: CursorMap} (merges into `v1/ack/<deviceId>`, keeping the max hlc per writer, then
  compacts).
- **Auth is per-pairing, not the device-key lock.** Header `X-Zanshin-Sync: <authKey>` (base64url, HKDF-derived
  on-device from the pairing secret). The server SHA-256s it and compares, constant-time, against the stored
  `v1/verifier` blob — a value the client already hashed before `init`. This is deliberately separate from
  `src/server/deviceKey.ts`'s `X-Zanshin-Device` lock: the device-key lock is one shared secret per Sagar
  (env var, gates every function); the sync verifier is per-pairing (Blobs, set once by whichever device pairs
  first) and is how a second device proves it holds the pairing secret.
- **hlc wire format.** `<13-digit wall-clock ms>-<1-8 hex counter>`, zero-padded so two hlcs from one device sort
  lexically in time order (`src/server/sync/schema.ts` `HLC_RE`). `src/domain/sync/hlc.ts` (a later M3 client
  card) is expected to emit exactly this shape; until it lands, this schema is the source of truth for the wire
  format, and the server validates every `<hlc>` path segment against it regardless of which side writes it.
- **Every cursor is per-writer, never a single global key (protocol correction, PR #52 review).** Log keys are
  `v1/log/<deviceId>/<hlc>`, so they sort by *device first*. An earlier version of this protocol used one global
  cursor (a full log key) for `GET log`, `ack`'s `through` and a snapshot's bootstrap point; once that cursor
  landed inside one device's key range, a *different* device's new entries sorted before it and were silently
  skipped — `v1/log/<deviceId>/<hlc>` keys sort as strings, not as a merged timeline. So: `GET log` takes a
  `device` query param and returns only that writer's own log, paged by its own hlc; `ack`'s `through` and a
  snapshot's `cursor` are both `CursorMap`s (`{writerId: hlc, ...}`), one independent entry per writer
  (`src/server/sync/schema.ts` `CursorMap`, `parseCursorMap`, `mergeCursorMax`). A client reads every known
  writer's log with one `GET log?device=` call per writer, not one call across all of them.
- **Known devices and compaction safety.** A device is "known" once it has written a log entry or an ack.
  Compaction in `ack` deletes writer W's log entries only when **every OTHER known device's** `acked[W]` ≥ the
  entry's hlc **and** the newest snapshot's `cursor[W]` ≥ the entry's hlc; W never needs to ack its own log. A
  known device missing an `acked[W]` entry (or none at all) blocks compaction of W's log; with no snapshot yet,
  compaction never runs.
- **Env vars.** None new — sync has no secret of its own; the verifier lives in Blobs, set at pairing.
- **Logging.** One `ZT1` line per request (route, status, latencyMs, bytes, and — on `log`/`ack`/`log?device=`
  routes — the first 4 characters of the relevant `deviceId`). Never the verifier, the auth header, a body, or a
  full key.

## 7. Root-cause analysis and self-heal protocol

Every failure (CI red, flaky test, production error, a report from Sagar) goes through the same loop. Do not
retry blindly and do not paper over with timeouts.

1. **Capture evidence** — exact error text, annotations, request/function logs, the failing assertion and the
   page snapshot (`test-results/*/error-context.md`).
2. **Reproduce** locally with the narrowest command (one spec, `--retries=0`, both projects if layout-related).
3. **Classify:** product bug · test bug (race, brittle locator) · environment (CI image, proxy, browser) ·
   data (Wavu changed) · flake (passes on retry with no code change).
4. **Five whys** to the root cause; write it in one sentence.
5. **Fix the cause, add a guard** — a regression test, a lint rule, a doctor check, or an in-app self-repair.
6. **Log it** in `docs/ops/RCA_LOG.md` (date · symptom · root cause · fix · guard) and, if it is a new class,
   add it to the catalog below.
7. A flake that recurs twice becomes a bug to fix, not a retry.

Escalate to Sagar only when the fix needs his credentials, money, or a product decision that could go either
way; otherwise fix and report after.

### Failure catalog (symptom → cause → fix)

| Symptom | Root cause | Fix / guard |
| --- | --- | --- |
| Browser keeps showing an old version after deploy | Netlify SSO session expired → 401 on `sw.js`; SW serves the old shell | 1.4.1 sign-in banner; diagnose with request logs (401s on `/sw.js`, `/version.json`) |
| `page.evaluate`: execution context destroyed after a click that reloads | `waitForLoadState` resolved on the old document | Register `page.waitForEvent('load')` before the click, await it after |
| axe colour-contrast fails on a button only in one run | Sampled mid opacity transition | No opacity transitions on buttons; wait for enabled before axe |
| Hero "inside stage" check fails | Measured during the entrance slide | Scale entrance with right-bottom origin; test waits 500 ms |
| A setting toggled in a test is gone after `page.goto` (CI only) | Optimistic toggle; the IndexedDB write was aborted by the immediate navigation | Check the effect with an in-app navigation first, then reload |
| A size check fails by 0.00004 px ("expected 480, received 479.99996") | Exact `toBe` on `boundingBox()` floats; any relayout re-rounds fractional boxes | `toBeCloseTo(value, 1)` (0.05 px); keep a CLS check for real shifts |
| `getByText` matches text in a collapsed panel | Hidden content rendered in the DOM | Render collapsible content lazily |
| Frame tier wrong for `−12` | Unicode minus (U+2212) in data | ASCII `-` in data and samples |
| ESLint `no-color-literals` flags `'&#039;'` in tests | Rule matches `#` + hex-like text in strings | Build such strings with `[...].join('#')` / `\u0023` |
| ESLint fails on files you never touched | Stray scratch files inside the repo | Keep scratch in the scratchpad, never the repo |
| Blank app at runtime, "reading 'exports'" | Over-eager `manualChunks` split a CJS dependency across chunks | Only the gated library groups in `vite.config.ts` |
| Contrast unit test fails after a token tweak | `--art-plate` mix share is part of the tested pair | Keep 90 % or re-run the contrast spec per scheme |
| A size or colour changes after unrelated imports | Two single-class rules tie on specificity; bundle order decides | State the intended value on the more specific component rule; never rely on CSS order |
| axe `label-content-name-mismatch` | `aria-label` doesn't contain the visible text | Make the label start with (or equal) the visible text |
| Media audit 404s | Media root resolved relative to the script | Pass the media root explicitly |
| Spend counter (or any counter) in Blobs lags or the cap overshoots | Read-modify-write on one key; Blobs is last-write-wins, parallel calls lose increments | One key per event (`onlyIfNew`), totalled by `list({prefix})`; test with a store whose reads answer late |
| A Hermes worker branches from old code | Worktrees are cut from the local clone `D:\RUDRA\zanshin`, which goes stale unless fetched | The bridge fetches and fast-forwards `main` every run; compare the worktree `HEAD` with `origin/main` |
| Hermes card blocked with "exited with code 1" seconds after spawn | The worker profile has no AI provider it can resolve (a model chosen in the chat TUI is not enough) | Put the provider key in the profile's own `.env` (`hermes -p <profile> config set ANTHROPIC_API_KEY …`); prove it with `hermes -p <profile> chat -q`; read `outbox\logs\<profile>-managed-worker.log` for the real error |
| E3 debrief "Mastery … → …" missing once (desktop, under load) | Open: debrief renders before mastery deltas are computed | Watch; if it recurs, make the debrief wait for the deltas (and test it) |
| `page.keyboard.press('Tab')` lands on the wrong element once, then passes on retry | Test asserted on a locator (e.g. `#main`) that a loading fallback also renders, so it can resolve before the real shell (skip link, top bar) has committed | Assert on the shell itself (a stable, shell-only element) before the first keyboard interaction, never a fixed sleep |

## 8. Decisions (and why)

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-03 | SSO Option B shipped: `intel`, `diag` and `ranked` all lock to paired devices; sync pairing registers the device-key hash (`v1/devicekeyhash`, write-once) in the same `POST init` request as the verifier | No manual hash step or extra deploy before the site can go public — pairing alone is enough (card sso-b-lock) |
| 2026-11-02 | **One-hour SSO: Option B** — make the site public, lock every function to paired devices with a key | Sagar's choice (2026-11-02). Order matters: ship the device-key lock on `intel`, `diag`, `ranked`, `sync` first, verify, *then* switch the Netlify project's visibility; never public before the lock is live |
| 2026-11-02 | Both Hermes workers run Claude Sonnet on Sagar's own Anthropic API key (Ultra plan credits, $150/month spend limit); Nous Portal stays on the free plan for its tools | Free Nous models left the workers with no resolvable provider, which crashed every worker on spawn; the key lives in each profile's `.env`, never in the repo |
| 2026-11-02 | Hermes Agent on Sagar's PC (RUDRA) as extra builders: profiles `zanshin-dev`, `zanshin-qa`; Claude leads via cards in `D:\RUDRA\hermes\inbox`, reads `outbox\board.json` (protocol: `D:\RUDRA\hermes\HANDOFF.md`) | Keeps the build moving when Claude's capacity runs out; workers read `AGENTS.md` (not `CLAUDE.md`), open PRs, CI gates them; runs only while RUDRA is on and `hermes gateway` is running |
| 2026-11-01 | Production deploys only on releases; PRs get free previews | Free plan: 300 credits/month, 15 per production deploy; 9 deploys in 16 h had used ~135 |
| 2026-11-01 | 2.0 is built in milestones, each merged when green and reviewable on its PR preview; production gets releases | Sagar sees each milestone on its preview and can redirect; credits go only on releases |
| 2026-11-01 | Sync between PC and phone is in 2.0 scope | He uses both (answer 2026-11-01) |
| 2026-11-01 | `version.json` probe + Sign in again (1.4.1) | Expired SSO silently blocked updates |
| 2026-10-31 | Perplexity behind a Netlify Function with a daily cap | Key never reaches the browser; spend bounded |
| 2026-10-31 | Colours only in tokens; AA tested per scheme | Four schemes stay consistent and readable |
