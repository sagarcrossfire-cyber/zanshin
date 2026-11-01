# ZANSHIN — Reference (read this first)

The single document a Claude session needs before touching this project. It exists to stop context drift
across sessions and compactions. **Order of truth: the code > this file > memory/summaries.** When they
disagree, fix this file in the same PR.

- Update this file in every release PR (version line, sections touched, new failure modes).
- The plan for the current major version lives in `docs/v2/PLAN.md`. The failure log is in `docs/ops/RCA_LOG.md`.
- A copy of this file is kept in the claude.ai Project "Tekken" (`claude/REFERENCE.md`). Refresh it with
  `Projects` → `project_write` (`local_path`) after each release.

Current version: **1.4.1** (main `f4d858f`). Next: **2.0** (see `docs/v2/PLAN.md`).

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
| Function | `netlify/functions/intel.mts` → `/.netlify/functions/intel/*` (health, usage, research, …), spend in Netlify Blobs |
| CI | `.github/workflows/ci.yml`: `quick` → `e2e` (phone+desktop, then Netlify-headers run) + `media` → `deploy` (main only, `netlify deploy --no-build`); monthly cron `17 9 1 * *` |
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
- Updates: `version.json` (build-emitted, not precached, `no-store`) is probed by `src/services/siteAccess.ts`;
  401/403 → "Sign in again" banner; another version → `registration.update()` → "Update available, reload" toast,
  which never interrupts a Lab session (`src/services/updateGate.ts`).

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
7. Watch the `main` run through `Deploy to Netlify`, then verify: Netlify MCP `get-project` (current deploy id) →
   `get-deploy-for-site` (published, header/redirect rule counts) → `get-request-logs` (live requests, e.g.
   `/version.json` 200). The site itself cannot be opened from here.
8. Update this file, `README.md` (versions list), `docs/RELEASE_<v>.md`, `package.json` + `APP_VERSION`
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
- Housekeeping still open: PRs #9, #11, #12 (stale, cannot be closed through the proxy — Sagar can close them),
  #13 Dependabot.

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
| `getByText` matches text in a collapsed panel | Hidden content rendered in the DOM | Render collapsible content lazily |
| Frame tier wrong for `−12` | Unicode minus (U+2212) in data | ASCII `-` in data and samples |
| ESLint `no-color-literals` flags `'&#039;'` in tests | Rule matches `#` + hex-like text in strings | Build such strings with `[...].join('#')` / `\u0023` |
| ESLint fails on files you never touched | Stray scratch files inside the repo | Keep scratch in the scratchpad, never the repo |
| Blank app at runtime, "reading 'exports'" | Over-eager `manualChunks` split a CJS dependency across chunks | Only the gated library groups in `vite.config.ts` |
| Contrast unit test fails after a token tweak | `--art-plate` mix share is part of the tested pair | Keep 90 % or re-run the contrast spec per scheme |
| Media audit 404s | Media root resolved relative to the script | Pass the media root explicitly |
| E3 debrief "Mastery … → …" missing once (desktop, under load) | Open: debrief renders before mastery deltas are computed | Watch; if it recurs, make the debrief wait for the deltas (and test it) |

## 8. Decisions (and why)

| Date | Decision | Why |
| --- | --- | --- |
| 2026-11-01 | 2.0 is built in milestones, each shipped to production when green | Sagar gets value early and can redirect; every milestone is self-contained and tested |
| 2026-11-01 | Sync between PC and phone is in 2.0 scope | He uses both (answer 2026-11-01) |
| 2026-11-01 | `version.json` probe + Sign in again (1.4.1) | Expired SSO silently blocked updates |
| 2026-10-31 | Perplexity behind a Netlify Function with a daily cap | Key never reaches the browser; spend bounded |
| 2026-10-31 | Colours only in tokens; AA tested per scheme | Four schemes stay consistent and readable |
