# ZANSHIN 1.2.0 — bundled media and a hardened pipeline

Base: 1.1.0 (`bfeb86d`, Amendment 01B). Schema stays at v4.

## What changed for Sagar

- **The art comes with the site.** The deploy builds a media pack from Wavu Wiki (icons and portraits for the roster, every Yoshimitsu clip) and publishes it under the site's `/media/` folder. Each device picks it up on its own the first time the app runs after this release, and again after any refresh: a toast says how many items arrived, and Settings → Images and clips shows when the site was last checked, with a switch and a "Check now" button. No zips to carry around any more; importing still works for extras (opponent clips, rank badges, replay captures).
- **Nothing is fetched from anywhere but this site.** The rule from 01B stands for every other origin.
- **Safer hosting.** The site now answers with a Content Security Policy (own scripts only, no framing, blob-only images and clips, outbound connections only to this site, Wavu and the configured coach provider), no-sniff, a strict referrer policy, a permissions policy that keeps fullscreen and wake lock (the Lab needs them) and nothing else, and cache rules that make a new release show up on the next visit while hashed assets and media are cached for a year.
- **A pipeline instead of uploads.** GitHub Actions runs every check and deploys to Netlify only when all of them pass; the first of each month redeploys with refreshed media.
- Settings defaults for snapshot retention and the backup reminder now match the reference (7 daily, 5 event, 14 days). Nothing read these fields yet.

## Design

- `src/services/bundledMedia.ts`: `seedBundledMedia()` fetches `/media/manifest.json` (same origin, `cache: no-cache`, credentials included so Netlify's sign-in cookie travels with it), parses it with the pack schema, compares every item's `kind|subjectKey` and SHA-256 against the stored rows, downloads only what is missing or changed (four at a time), and hands the bytes to the same `importMediaItems` loop the zip importer uses (size and SHA-256 checked before anything is stored). It runs from `AppLayout` in idle time once the app is up, re-runs when the device comes online, at most every 6 hours (localStorage stamp), never in Safe Mode, and never when `mediaBundledAuto` is false. The result is kept under the meta key `media:bundled`. Failures are recorded for Diagnostics and never surface as more than a line on the Media screen.
- `importMediaPack` was split: `parseMediaManifest` + `importMediaItems(items, read, options)`. The loop gained `unchanged` (same bytes already stored → untouched), an `origin` option (`pack` | `file` | `site`) and an `AbortSignal`.
- The script's `--site-dir` mode writes `media/<kind>/<sha256-16>-<slug>.<ext>` plus `manifest.json` with a `packId` (hash of every item's hash) and clears anything stale from the folder first. File names are content-addressed, so `/media/*` is served `immutable`; the manifest is `must-revalidate`.
- `scripts/ensure-media-manifest.mjs` runs in `prebuild`: a build without the media job (local, pull request) still ships an empty manifest, so the app's check gets a quiet 200 instead of a 404 (which browsers log as a console error).
- `public/_redirects`: a missing `/media/*` answers 404 (the app reads that as "no bundled media"); every other unknown path opens the app.
- `scripts/serve-dist.mjs` serves `dist` the way Netlify does (static first, `_redirects`, `_headers`) and `playwright.netlify.config.ts` runs smoke, media, PWA and Today specs against it, so a header that would break the app fails CI rather than production.
- The service worker ignores `media/**` (`globIgnores`): tens of megabytes do not belong in the precache; IndexedDB holds them.
- The service worker no longer runtime-caches Wavu's API (the 1.0.0 `NetworkFirst` route). Patch Watch and the importer keep their own last-known state, and a cached API answer served offline would have let "Check for updates" claim the data was current. Requests the worker does not handle are made by the page, which is also what makes the end-to-end mocks deterministic: in CI, where the runner can reach Wavu, the worker was answering the mocked requests for real.

## Decisions

| Id | Decision | Why |
| --- | --- | --- |
| D-120-1 | Media is bundled with the private site and seeded into IndexedDB, rather than referenced by URL | The app stays offline-first and every existing media code path (variants, ink tone, consistency checks, export) keeps working; anyone who can open the site can see the art, which today is only Sagar |
| D-120-2 | Media is built in CI from Wavu, cached between runs, never committed | Keeps the repository small and the art out of git history; the cache re-verifies each file against Wavu's checksum, so a refresh downloads only what changed |
| D-120-3 | GitHub Actions deploys to Netlify with `netlify-cli --no-build`; a build started on Netlify's side runs `scripts/netlify-build.sh` (same gate, media and build) | One place runs the gate and the deploy, the full browser suite runs before anything ships, the Netlify token lives only in GitHub's secrets, and a deploy through the Netlify connector still produces the same site |
| D-120-4 | `connect-src` allows any https host plus localhost | The coach provider's base URL is user-configured (it can be a local server); pinning hosts would break that setting |
| D-120-5 | `style-src 'unsafe-inline'` | React inline styles (hero focal point, image sizes, Recharts) need it; scripts stay `'self'` only |

## Tests

- Unit: `tests/unit/media/bundled.spec.ts` (seeding, deltas, interval, disabled/offline/Safe Mode, bad manifests, missing files) and new importer cases (`unchanged`, abort). 799 unit tests in all.
- Script: `scripts/tests/test_media_pack.py` gained site-mode coverage (content-addressed names, `packId` stability, stale-file cleanup) and now runs in CI.
- End to end: bundled seeding and the quiet no-media path in `tests/e2e/media.spec.ts`, plus the Netlify-style CSP run.

## For later

- Branch protection on `main` (require the `quick` and `e2e` checks, no force pushes) via a repository ruleset, once Sagar has decided whether the repository stays public.
- Opponent clips in the bundled pack (`--opponents all` roughly doubles its size); today they import as a separate zip.
- Syncing training data between devices (a backend) is a separate decision.
