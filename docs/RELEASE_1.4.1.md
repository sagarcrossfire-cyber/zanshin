# ZANSHIN 1.4.1 — The app notices when the site sign-in expires

Base: 1.4.0 (`9e47310`). Schema unchanged (v5). No data changes.

## What happened

1.4.0 deployed correctly, but Sagar's browser kept opening the old 1.3 app. Netlify's request log for his visits showed every request his browser made refused with **401** (`/sw.js`, `/media/manifest.json`, `/`). The site is a private Netlify project, so every request needs his Netlify sign-in, and that sign-in had expired in his browser. The service worker still served the saved copy of the app, so it opened normally, but the browser's update check for `/sw.js` was refused. The app stayed on the version it had last installed and gave no sign that anything was wrong. The dashboard's "Errors 69%" was those refused requests.

## What changed for Sagar

- **"Your sign-in to this site has expired."** When the site refuses the app's check, a banner under the top bar says so and offers **Sign in again** and **Later**. Sign in again removes the saved copy's service worker and reloads. The reload goes to the site, Netlify shows its login, and the fresh app installs a fresh worker. Your log, settings and media in IndexedDB are not touched. Later hides the banner until the app is next opened.
- **Updates show up sooner.** When the site already serves a different version than the one running, the app asks the browser to fetch it immediately, and the usual "Update available, reload" toast appears, instead of waiting for some later page load.
- One-time catch: this fix reaches a browser only after it has signed in once (DevTools → Application → Service workers → Unregister, reload and log in; or Ctrl+Shift+R and log in). From then on, the banner handles it.

## How it works

- `version.json` is written into `dist` at build time (`{"format":"zanshin-version","version":"1.4.1"}`, from `package.json`). It is **not precached** (`globIgnores`), and `public/_headers` serves it `Cache-Control: no-store`, so the answer always comes from the site.
- `src/services/siteAccess.ts` asks for it at start-up (idle time, after the worker registers, never in Safe Mode), when the app returns to the foreground (at most every 5 minutes), and when the device comes back online. 401 or 403 means the sign-in expired. A version file means signed in, and a different version calls `registration.update()`. Offline, 404 (dev server) and server errors change nothing. A 200 that is not the version file still counts as signed in, so the SPA fallback can never raise a false alarm.
- The worker's navigation fallback now skips `/.netlify/*`, so Netlify's own paths (functions, its login) always reach the site rather than the saved app shell.

## Tests

- Unit (`tests/unit/services/siteAccess.spec.ts`, 9): classification of 200/401/403/404/500/offline/non-JSON; the banner shows, hides with Later, clears when the site answers, and comes back on a later expiry; offline leaves it alone; the update nudge only on a different version; foreground throttling and reconnect checks; Sign in again unregisters every worker before reloading, and reloads even if the worker API throws.
- End-to-end (`tests/e2e/site-access.spec.ts`, phone and desktop): no banner when signed in, and `version.json` names the build; with a 401, the banner explains, Later hides it and Sign in again reloads; with the real service worker in control, `version.json` is absent from the precache, the signed-out reload is served by the worker, the banner appears, and after **Sign in again** the reload is answered by the network and the page is uncontrolled. That is the path that reaches Netlify's login.
