# ZANSHIN — Yoshimitsu Mastery

A personal, local-first Tekken 8 coaching app for one player. Frame data from Wavu Wiki, a curriculum from controls to Tekken King, a Lab for drills, a Punish Trainer, flashcards, a match log, matchups, progress charts and an optional AI coach. Everything a player records stays in the browser (IndexedDB); the only outbound requests are to Wavu Wiki's API, the AI provider the player configures, and this site's own origin (its media folder and, since 1.3.0, its intelligence function).

Unofficial. TEKKEN is a registered trademark of Bandai Namco Entertainment Inc.; character art and move clips are © Bandai Namco Entertainment Inc., via Wavu Wiki.

## Stack

React 18 · TypeScript (strict) · Vite 6 · Zustand · Dexie (IndexedDB) · Zod · vite-plugin-pwa · Vitest · Playwright · axe.

Rules the code base keeps (enforced by ESLint rules and `scripts/check-*.mjs`): only repositories touch IndexedDB; screens never call `fetch`; no colour literals outside `src/styles/tokens.css`; domain code is pure and covered at 90%+. Since 1.4.0: every scheme passes WCAG AA for every text and signal colour (unit test), and no image may be cropped (end-to-end test).

## Running it

```
npm ci
npm run dev            # http://localhost:5173
npm run verify:quick   # typecheck + lint + unit tests
npm run build          # renders icons, writes an empty media manifest if none, builds dist/
npm run test:e2e       # full browser suite against `vite preview` (phone + desktop)
npx playwright test -c playwright.netlify.config.ts   # smoke/media/PWA with Netlify-style headers (CSP)
```

## How it ships

```
push / PR ──► quick (types, lint, unit, data, build, budget)
                 ├──► e2e (full Playwright suite, then the CSP run)
                 └──► media (Wavu Wiki ──► public/media, cached between runs)   [main, schedule, manual]
                              └──► deploy (build with media ──► Netlify, production)  [main only]
```

`.github/workflows/ci.yml` does all of it. A pull request gets the checks; a push to `main` that passes them is deployed. The first of every month redeploys with refreshed media, so new clips after a game patch arrive on their own. Nothing is deployed from a laptop.

The deploy step needs two repository secrets, which only the repository owner adds: `NETLIFY_AUTH_TOKEN` (Netlify → User settings → Applications → Personal access tokens) and `NETLIFY_SITE_ID` (Netlify → Project configuration → General). Until they exist, the deploy job builds, says what is missing, and ends green.

## Intelligence

Release 1.3.0 adds one Netlify Function, `netlify/functions/intel.mts` (logic in `src/server/intel/`), which holds the Perplexity key and answers the app at `/.netlify/functions/intel/*`: the coach on a frontier model (Settings → Coach → *ZANSHIN intelligence*), *Look it up* web research with sources (Coach tab), matchup primers (character pages) and patch briefs (Patch Watch). The Netlify site needs `PERPLEXITY_API_KEY`; `INTEL_DAILY_CAP_USD` (default 3) caps the day's spend. Web-sourced text is kept as research notes with a *Web-sourced* badge and never written into frame data. `docs/RELEASE_1.3.0.md` has the design.

Netlify normally receives finished deploys; when a build is started on Netlify's side instead (a deploy through the Netlify MCP connector, or a repository linked in the Netlify UI), `netlify.toml` runs `scripts/netlify-build.sh`, which is the same gate, media step and build. Response headers (a Content Security Policy, frame denial, caching) are in `public/_headers`; routing in `public/_redirects`.

## Branch protection

The pipeline is only a gate if `main` cannot be pushed to directly. Set this once in GitHub (Settings → Rules → Rulesets → New branch ruleset; the GitHub app this repo is driven from cannot create rulesets):

- Target: default branch. Enforcement: active. No bypass actors.
- Rules: restrict deletions; block force pushes; require a pull request (0 approvals is fine for a solo repo); require status checks **Types, lint, unit tests, build** and **Browser tests (phone and desktop)**.

After that every change, including the agent's, goes through a pull request that CI has passed, and `main` is always a tested, deployed state.

## Media

The app shows no game art of its own. Two things fill it:

- **Bundled media** (release 1.2.0): the deploy pipeline runs `scripts/make_zanshin_media_pack.py --site-dir public`, which downloads character icons and portraits for the roster and every Yoshimitsu move clip from Wavu Wiki and writes them, content-addressed, under `public/media/` with a `manifest.json`. On each device the app reads that manifest from its own origin when it starts (and after it comes back online), stores whatever it lacks in IndexedDB, and shows it offline from then on. Settings → Images and clips has the switch and a "Check now" button.
- **Imported media**: the same script without `--site-dir` writes zips (`--opponents all` adds opponents' punishable moves) that import through Settings → Images and clips; single files (a rank-badge screenshot, a replay clip) import there too. Exports round-trip.

The media folder is generated at build time and never committed; the download cache (`.zanshin-media-cache/`) lives in the Actions cache.

## Repository layout

```
src/domain      pure logic (engine, notation, codex, coach, media subjects)
src/data        schemas, Dexie database, repositories, bundled packs, importers
src/services    app services (backup, snapshots, diagnostics, media library, bundled media, intel client, research…)
src/server      code that runs in the Netlify Function (Perplexity client, intel handler, blob store)
netlify         the function entry point
src/screens     one folder per screen
src/components  base and signature components
scripts         build and data tooling (icons, media pack, bundle budget, Netlify-style server)
tests           unit, integration, e2e (Playwright), fixtures, goldens
docs            amendments and release notes
```

## Versions

- 1.0.0 — the build Muse produced from the reference docs (schema v3).
- 1.1.0 — local media library (import packs and files), home-screen install fix (schema v4). `docs/AMENDMENT_01B_LOCAL_MEDIA.md`.
- 1.2.0 — bundled media served by the site, GitHub Actions pipeline with Netlify deploys, security and caching headers. `docs/RELEASE_1.2.0.md`.
- 1.3.0 — intelligence: coach on frontier models through the site's own function, Look it up with sources, matchup primers, patch briefs, daily spend cap (schema v5). `docs/RELEASE_1.3.0.md`.
- 1.4.0 — redesign "Ink and steel": four colour schemes, scene art behind every screen, uncropped stage heroes and portrait grid, a frame-data key and a readable move list. `docs/RELEASE_1.4.0.md`, `docs/redesign/`.
