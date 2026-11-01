# Root-cause log

Every failure that reached CI, production or Sagar, newest first. Protocol: `docs/REFERENCE.md` §7.

| Date | Symptom | Root cause | Fix | Guard |
| --- | --- | --- | --- | --- |
| 2026-11-01 | M1 e2e (desktop): axe `label-content-name-mismatch` on the rail search button | `aria-label` differed from the visible text ("Search or jump to… Ctrl K") | `aria-label` repeats the visible text exactly (kept for the collapsed rail, where the text is hidden) | `tests/e2e/a11y-routes.spec.ts` axe pass |
| 2026-11-01 | M1 e2e (phone): Today's Swap buttons measured 40 px, failing the 44 px rule that passed in 1.4.1 | Two single-class rules (`.z-btn` 44 px, `.z-timeline__swap` 40 px) tied on specificity; new nav imports changed the CSS bundle order, so the smaller one won | State the intended 44 px on `.z-timeline__swap` | `tests/e2e/a11y-routes.spec.ts` button sizes |
| 2026-11-01 | Cartographer review: practising any Stage 1+ lesson saved it as `locked`, so no stage after Stage 0 could pass its gate (not yet hit: Sagar is on Stage 0) | `recomputeNodeMastery` passed `stageOpen: stageIndex === 0` instead of the stored stage status | Use the stored stage status (open/passed); startup integrity check recomputes wrongly locked lessons | `tests/unit/lab/verify.spec.ts` (fails without the fix), integrity check `mastery-stage-lock` |
| 2026-11-01 | Local e2e: E3 (dark, desktop) debrief lacked the "Mastery … → …" line once; passed on retry; CI green | Not yet proven; likely the debrief renders before mastery deltas are computed when the machine is loaded | None yet (single occurrence) | Catalog entry; fix on second occurrence |
| 2026-11-01 | Phone e2e: `page.evaluate` "execution context destroyed" after Sign in again | Test waited with `waitForLoadState` on the old document | Wait on a `load` event registered before the click | `tests/e2e/site-access.spec.ts` |
| 2026-11-01 | Sagar saw the 1.3 app after 1.4.0 deployed; Netlify "Errors 69 %" | His Netlify SSO session expired: 401 on `/sw.js`, `/media/manifest.json`, `/`; the service worker kept serving the old shell | 1.4.1: `version.json` probe, Sign in again banner, update nudge; one-time manual unregister | Unit + e2e (real worker) tests; failure catalog entry |
| 2026-10-31 | Netlify-run axe contrast 2.92 on a button | Sampled mid opacity transition | Removed the opacity transition; test waits for enabled | `tests/e2e/design.spec.ts` |
| 2026-10-31 | Hero "inside stage" e2e failed | Measured during the slide-in entrance | Scale entrance; 500 ms wait | `tests/e2e/design.spec.ts` |
| 2026-10-31 | E4 matched text inside the closed legend | Collapsed legend still in the DOM | Legend rendered lazily | `tests/e2e/e2e-scripts-p12.spec.ts` |
| 2026-10-30 | Blank app, "Cannot read properties of undefined (reading 'exports')" | `manualChunks` hash-bucketing split lodash across chunks with a cycle | Reverted to gated library groups | Comment in `vite.config.ts`; full e2e |
