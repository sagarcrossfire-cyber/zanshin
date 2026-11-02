# ZANSHIN 2.0 — infrastructure research (platform engineer)

Date: 2026-11-01. Scope: read-only review of the connectors in this session plus the repo's deploy config. Nothing was changed, created, deployed or printed from secrets.

Files read: `netlify.toml`, `.github/workflows/ci.yml`, `netlify/functions/intel.mts`, `src/server/intel/{handler,store}.ts`, `public/_headers`, `public/_redirects`, `src/data/db.ts`, `src/services/{errorReport,backup,siteAccess,diagnostics}.ts`, `README.md`.

---

## 0. Headline finding: the Free plan's credit cap is the main 2.0 risk

**Evidence.**
- Netlify team "Sagar Patel's team" (`6ae4a3d7e593b12138d36fad`) is on the **Free** credit-based plan (`type_name: Free`, site plan `nf_team_dev`). It was created 2026-10-30. It has one member and `enforce_mfa: not_enforced`.
- Free gives **300 credits per month as a hard limit**. When they run out, "all your web projects are paused, and visitors see a `Site not available` page". Free cannot buy more credits. (Source: docs, *How credits work*.)
- **Each successful production deploy costs 15 credits.** Deploy Previews and branch deploys cost 0. Bandwidth costs 20 credits/GB, web requests 2 per 10k, and compute 10 per GB-hour.
- I read the GitHub Actions logs. **9 runs printed "Deploy is live"** between 2026-10-31 15:11 and 2026-11-01 07:33 UTC (runs 41213640211 … 41285274037). That is **135 credits on CI deploys alone in about 16 hours**, plus any first deploys made by drag-and-drop or MCP before CI took over. Observability shows about 82 MB of bandwidth in the last 24 h, which is roughly 1.6 credits/day.
- So roughly half the cycle's budget is already spent. At the 2.0 sprint pace (several merges a day), the site would pause within days and the PWA would stop updating. Cached copies keep working offline, but the intel function and the coach go dark.

**Fix (free, recommended whatever the plan):** stop deploying production on every merge to `main`. See §5.1: production deploys only on a release, and free SSO-protected draft deploys for every PR.

**Fix (paid, optional):** **Personal, $9/month**, gives 1,000 credits (about 60 deploys) and auto-recharge (500 credits for $5), so the site never pauses. Pro ($20/month, 3,000 credits) adds 7-day observability, env-var scopes, password protection and function region choice. None of those are needed for a one-person app.

**Sagar must:** open Team → Usage & billing to see the real balance and reset date (no connector exposes credit usage). Then choose "Free + release-gated deploys" or "Personal + auto-recharge".

---

## 1. Netlify: plan, features, limits, costs

| Feature | On this Free team? | Limits / cost | Notes |
|---|---|---|---|
| **Blobs** | Yes (already used: store `intel`, region us-east-2, strong consistency) | No storage meter listed; reads/writes cost function compute + bandwidth (negligible) | Site-wide stores are **shared across all deploy contexts**: a preview can read and write production data. No concurrency control (last write wins); `onlyIfNew` / `onlyIfMatch` exist. Objects ≤5 GB, metadata ≤2 KB, keys ≤600 B. |
| **Scheduled functions** | Yes (compute billing applies on credit plans) | **30 s** limit; cron in **UTC**; fire only on the **published production deploy** (not previews; "Run now" in UI) | `function_schedules: []` on the current deploy. |
| **Background functions** | Yes | 15 min, 256 KB payload, 202 response, retries at +1 and +3 min | A scheduled function calling its own background function by URL would go through the SSO wall. I expect that to fail; it is unverified. Avoid self-calls. |
| **Netlify DB (Postgres)** | Yes: 3 DBs, 20 active branches, 7-day backups | **Free: fixed 1 CU, sleeps after 5 min idle, 10 credits per CU-hour, cap 48 CU-h/period**, 5 GB storage, 5 GB egress; storage billing "no earlier than July 1 2026", rate not announced | Each wake-up holds at least about 5 min of compute (about 0.8 credits). Four syncs a day comes to about 100 credits/month, a third of the Free budget. Rejected for sync (§2). |
| **AI Gateway** | Yes: credit-based plans incl. Free; on by default; activates after one prod deploy (done) | **180 credits per $1** of provider usage; Free rate limit 90 credits/min per team; input ≤200k tokens; no prompt storage; OpenRouter ZDR-only | Providers: OpenAI, Anthropic, Gemini, TypeSafe, OpenRouter. Recent additions per Netlify changelog: Claude Haiku 5.5 (2026-10-07), GPT-6.1 Sol/Terra, Gemini 4 Argon. The live list is at `api.netlify.com/api/v1/ai-gateway/providers/detailed` (my sandbox could not reach it). **On Free, all 300 credits would buy about $1.67 of inference, and overspend pauses the site.** |
| **Image CDN** | Yes | Billed as requests/compute | Not useful: media is pre-sized at build time (Pillow), content-addressed, and shown from IndexedDB as `blob:` URLs. |
| **Deploy previews** | Unlimited, 0 credits | — | Not created today (Netlify is not Git-linked; CI deploys `--prod` only). **They would be SSO-protected.** The project reports `requiresSSOTeamLogin: true, whichProjectsRequireSSOTeamLogin: "all"`, and observability shows a **401 on the deploy permalink** `6ae6eff8…--glistening-conkies-c028b3.netlify.app/sw.js`. |
| **Observability** | Yes | **24 h window on Free/Personal**, 7 d Pro, 30 d Enterprise (verified: a 72 h query was clamped to 24 h) | Function logs are kept ≥24 h. `console.log` lines appear in each request's `logs[]` and can be searched with the `LogText` filter. |
| **Log drains** | **No: Enterprise only** | — | Rejected. |
| **Forms** | Available, free and unlimited; not enabled on this project (`forms: not enabled`, MCP shows `[]`) | Akismet spam filter; URL-encoded bodies only | Rejected for telemetry: stack traces risk spam-flagging and need form detection. |
| **Identity** | Available | Pro+ for custom email/audit | Rejected: it would add a second login inside the SSO wall, and Netlify documents no bridge between the two. |
| **Env vars** | Yes | **Scopes are Pro/Enterprise only**; team-shared vars Pro only; **about 4 KB combined limit across all function env vars** | On Free every var reaches builds and functions. Keep new keys short. |
| **Rate limiting** | "Firewall Traffic Rules & basic rate limiting" on Free | `config.rateLimit` in function config | Use on new endpoints. |
| **Skew protection** | **Off for this site**: it turns off when production is password/SSO protected | — | The service worker plus hashed assets already give atomic updates. No action. |
| **Webhooks into the site** | **Not possible**: private projects reject unauthenticated requests | — | Rules out Netlify-hosted webhook receivers (e.g. GitHub → Netlify). |

Current function (from deploy `6ae6eff8dd48c5312e650881`): `intel`, nodejs24.x, 1024 MB, region cmh (us-east-2), streaming invocation mode, with the observability extension attached. Deploy source: CLI.

---

## 2. Cross-device sync (PC + phone)

### Options compared

| | (a) Function + Blobs | (b) Netlify DB | (c) Supabase | (d) Cloudflare D1/R2 |
|---|---|---|---|---|
| Behind the existing SSO wall | **Yes** | Yes | No (own URL; needs Supabase Auth = second login) | No (public `workers.dev`; needs Access = second login, or a bearer token + CORS) |
| New account / pipeline | None | None | Org exists (`Yoshimitsu`, free, 0 projects) | Account exists (0 Workers, 0 D1; R2 not enabled) |
| Cost for one user | **<1 credit/month** | about 50–150 credits/month (wake-ups) | $0, but **free projects pause after 7 days of low activity**; backups not downloadable | $0 (5M reads, 100k writes/day, 5 GB) |
| Fit | Opaque encrypted batches, append-only | Relational, overkill | Overkill + double login | Fine technically, second platform |
| Verdict | **Recommended** | Rejected (credits) | Rejected (pausing, double login, data leaves the platform) | Rejected (second perimeter to secure and maintain; the Cloudflare MCP server is also deprecated per its own notice) |

### The auth gap, answered
- **A function cannot identify the Netlify visitor.** Netlify's access-control guidance says there is "no shared cookie, forwarded header, or JWT exchange" from the perimeter session to app code. A perimeter session represents a team member and is not passed to functions. The only documented signal is the response header `Netlify-Site-Protection-Expires-In`, sent to the browser. Netlify names no visitor cookie, and code must not rely on any undocumented cookie. The observability request detail (checked on a real `intel/research` call) has IP, Dallas geo, user agent, referrer and timings. It has no identity and no headers.
- **On Free, though, a private project is owner-only.** Any request that reaches a function has passed Sagar's Netlify (Google) login. The perimeter effectively is the identity.
- **Defence in depth anyway.** If visibility is ever flipped to Public by mistake, sync should still be safe. So use end-to-end encryption plus a sync auth key (below). Then the function only ever stores ciphertext and rejects callers without the key.
- **The SSO session lasts about 1 hour.** Sync calls will then get 401. Release 1.4.1 already detects this (`siteAccess.ts`). Sync must keep changes queued and resume after "Sign in again". On iOS, check that the installed PWA's separate cookie jar keeps the Netlify sign-in.

### Recommended design: an encrypted per-device operation log in Blobs
- **Store:** Blobs `sync` for production. Pick the name from `context.deploy.context` (e.g. `sync-preview` elsewhere) so a deploy preview can never touch the real log. Use strong consistency.
- **Keys:**
  - `v1/log/<deviceId>/<hlc>`: an AES-GCM-encrypted batch of changes, written with `onlyIfNew`. Each device writes only its own prefix, so there is no write contention and no read-modify-write.
  - `v1/snap/<hlc>`: an encrypted full-state snapshot for bootstrapping and compaction. Keep the last 3. This also gives Sagar an off-device backup, which he does not have today: data lives only on each device unless exported.
  - `v1/ack/<deviceId>`: each device's cursor, used to compact log entries older than a snapshot every device has seen.
  - `v1/verifier`: the SHA-256 of the auth subkey, set once at pairing with `onlyIfNew`.
- **Function** `netlify/functions/sync.mts`, `config.path: "/api/sync/*"`, `rateLimit` ≈120/min:
  - `GET state`
  - `GET log?after=<key>&limit=…` (paged; stay under the 6 MB buffered payload)
  - `PUT log/<device>/<hlc>`
  - `PUT snap/<hlc>`
  - `POST ack`
  - All require header `X-Zanshin-Sync: <authKey>`, checked against the verifier.
- **Keys and pairing:** the first device generates a 256-bit secret. It shows it as a QR code or word code, and the phone enters it. HKDF derives `encKey` (AES-GCM) and `authKey`. Keep the secret as a non-extractable CryptoKey in IndexedDB. Include it in a backup export only on explicit opt-in. Lose every device and every export, and the server copy is unreadable. That is by design.
- **Data model** (from `src/data/db.ts`, schema v5; v6 is already reserved):
  - *Append-only, merged as a union by `id`:* `sessions`, `sets`, `matchSets`, `reviews`, `assessments`, `verifications`, `coachMessages`, `research`.
  - *Mutable, last-writer-wins per record:* `profile`, synced subset of `settings`, `cards`, `cardStates`, `moveNotes`, `problemMoves`, `stageStatus`, `conflicts`.
  - *Derived, recomputed after merge, not synced:* `mastery` (from `sets`, via `recomputeNodeMastery`).
  - *Device-local, never synced:* `meta`, `packs` (bundled), `media`/`mediaBlobs` (re-fetched from the bundled pack; imported media could be a later opt-in), `snapshots`, `errors`, and **any API keys in settings** (the backup code already excludes secrets).
- **Change capture:** repositories are the only IndexedDB writers, so hook them there into a v6 `syncOutbox` table, plus a `syncMeta` table holding `table:id → hlc`. Existing record schemas do not change.
- **Conflict strategy:** last-writer-wins per record using a hybrid logical clock (`wallMs-counter-deviceId`). Deletes are tombstones. Append-only tables cannot conflict. The one lossy case is the same flashcard reviewed offline on both devices before syncing: the later review's SRS state wins. That is acceptable for one person. The stricter fallback is to sync a review event log and recompute `cardStates`.
- **When to sync:** on app open, on focus, on coming back online, and debounced after writes. Do not rely on Periodic Background Sync (not on iOS).

---

## 3. Scheduled work

| Job | Where | Why | Result lives in |
|---|---|---|---|
| **Wavu frame-data refresh / patch diff** (nightly) | **GitHub Actions cron** | Frame data is versioned and must pass the CI gate. A diff should become a PR with a patch-diff table, not a silent runtime change. Production only redeploys (15 credits) when something actually changed. | git → bundled packs |
| Monthly media refresh | GitHub Actions (existing) | Change it to **deploy only if `manifest.packId` changed**. Today it costs 15 credits every month even when nothing changed. | `public/media` in the deploy |
| **Ranked matches** (nightly) | **Netlify scheduled function** | A public source exists: **ewgf.gg API**, `GET /external/battles/{tekkenId}`, Bearer key. Free tier: 100 requests/day, last 50 battles, 24 h delay. Nightly needs 1 request. The key stays on Netlify next to the Perplexity key. | Blobs `matches/<date>.json`. The app pulls `/api/matches?since=` and dedupes by battle id into `matchSets` imports. |
| **Morning brief** | Split it | With end-to-end encrypted sync the server cannot read Sagar's training data. So the server pre-generates only the **public** part: patch, meta, Wavu changes, last night's ranked results. It uses the existing Perplexity path and spend cap, about $0.01/day. The **personal** part is generated on-device on the day's first open through the intel coach, showing yesterday's cached brief while it runs. | Blobs `brief/<date>.json` (public part); IndexedDB (personal part) |
| Daily telemetry digest + Blobs retention sweep | Same scheduled function | See §4 | Function log line + Blobs |

Scheduling notes:
- Cron is UTC. Request geo shows Dallas, which is CST (UTC−6) since DST ended today. `"37 11 * * *"` fires at 5:37 AM CST, or 6:37 AM CDT in summer.
- Keep each scheduled function under 30 s. The observed Perplexity research call took 7.9 s.
- If one job could run long, split it into two schedules rather than chaining by URL.
- GitHub limitation: a PR opened with the default `GITHUB_TOKEN` **does not trigger workflows**, so the required checks would never report on the bot's PR. The Wavu-diff bot needs a **fine-grained PAT or GitHub App token** limited to this repo (contents + pull requests write). **Sagar must add this secret.**

---

## 4. Production telemetry for autonomous root-cause analysis

### What exists today (checked live, read-only)
- **Last hour:** 0 requests (quiet).
- **Last 24 h:** about 1,200 requests (1,126 × 200, 58 × 401, 9 × 499, 5 × 304, 2 × 204). By agent: 628 browser, 570 tooling, 2 page-preview.
- **`intel` ran 4 times**, all 200: `usage` ×2, `health`, and `research` (7.95 s). **Every `logs[]` array is empty.** The intel function writes no log line, so there are no server breadcrumbs for RCA.
- 401s include CI's own health probe and stray permalink and asset requests, as expected behind SSO. The 9 × 499 (client closed the request) are worth tagging once telemetry exists.
- Request detail gives client IP, geo, UA, referrer, durations, cache status and per-operation timings. Retention is 24 h.

### Design (privacy-safe; it is Sagar's own app)
1. **`netlify/functions/diag.mts`** at `/api/diag`, POST, `rateLimit` 60/min.
   - It validates a Zod schema shared with the client.
   - It writes **one structured line** with `console.error('ZT1 ' + JSON.stringify(evt))`. Claude can then query it with `get-request-logs` + `FunctionName=diag` or `LogText="ZT1"`, and open `get-request-detail` for UA and geo.
   - It also writes `diag/<YYYY-MM-DD>/<ts>-<rand>` to Blobs, capped at about 500 per day, for history beyond 24 h.
2. **Event shape:**
   - `kind` (error | unhandledrejection | sw | idb | quota | intel | sync | boot-selftest | perf)
   - `release` / `sha`, `schema` version, `route`, `deviceLabel` (user-chosen "pc"/"phone"), coarse `ua` class
   - `online`, `storageEstimate`, a per-launch random `sessionId`
   - `fingerprint` (hash of name + top frame), `message`, `stack`
   - `message` and `stack` go through the existing `sanitizeErrorText` and are truncated to 2 KB.
3. **Never send:** IndexedDB content (notes, match logs, coach text), API keys, or IP (Netlify already records IP; do not repeat it).
4. **Client side:** extend `errorReport.ts`. Its global handlers already write a ring buffer; also queue to the endpoint. Use `sendBeacon`/`fetch keepalive`, dedupe by fingerprint per session, and keep an offline queue in IndexedDB. Add a Settings → Diagnostics on/off toggle.
5. **`intel` breadcrumbs:** one `ZT1` line per request (route, status, latency, model, cost, cache hit, cap state). Never the prompt or answer text.
6. **Boot self-test after each update:** on the first open after a new version, the app checks intel `health`, sync `state`, service-worker version and IndexedDB open time, then posts `boot-selftest`. This is the real smoke test, because it runs in Sagar's signed-in browser.
7. **Seeing past 24 h:** the Netlify MCP has no Blobs reader. So the nightly scheduled function re-logs a **rolling 7-day digest** (counts per fingerprint, first/last seen, release) as one `ZT1 digest` line. Claude can always see the last week inside the 24 h window. It also deletes diag blobs older than 30 days.
   - Do **not** export diagnostics into GitHub Actions summaries or artifacts: **the repo is public**, so those are public.
8. **Readable stacks:** build with `build.sourcemap: 'hidden'` and keep the maps as a CI artifact named by sha. The source is already public, so this exposes nothing new. Claude can then map minified frames to source.

Cost: well under 1 credit/month.

### Side bug found in the existing spend cap (`src/server/intel/store.ts → addUsage`)
- It reads, modifies and writes a single key, `usage/<day>`.
- Netlify documents Blobs as last-write-wins with no concurrency control.
- Parallel paid calls (e.g. several matchup primers prefetched at once) can lose increments and overshoot the cap.
- Fix: one ledger key per call (`usage/<day>/<requestId>`, `onlyIfNew`), summed with `list({prefix})`; or an `onlyIfMatch` etag retry loop.

---

## 5. CI/CD

### 5.1 Release-gated production + free PR previews (the credit fix)
- **Production `--prod` deploys** only when `package.json` `version` changes on `main`, on a `v*` tag, or on `workflow_dispatch`. Every other merge to `main` still runs the full gate and builds, but does not publish.
- **Every same-repo PR** gets `netlify deploy --dir=dist --functions=netlify/functions --no-build --alias pr-<n> --json`. That is a non-production deploy at 0 credits, behind the same SSO wall, as evidenced above. Put its URL in the job summary (the URL is public, the page is not).
  - Skip it when the token is absent. Fork and Dependabot PRs get no secrets, which is correct.
  - **Check once on the Usage page that CLI alias deploys really show 0 credits.** The docs say previews and branch deploys are free, but they do not mention CLI drafts explicitly.
- Caveats for previews:
  - Scheduled functions do not run on previews.
  - Previews share site-wide Blobs. That is fine for the spend cap, but sync/diag must use context-scoped store names (§2).
- **Monthly media redeploy:** only when `packId` changed.
- **Pin `netlify-cli`.** `npx netlify-cli@latest` in the deploy step is unpinned, which risks supply-chain problems and surprise breakage.

### 5.2 Smoke testing without passing SSO
CI cannot get through the SSO wall. Netlify offers no automation bypass token, and these settings have no API. What works without new secrets:
1. **Assert the wall.** `GET /` and `/.netlify/functions/intel/health` must return **401**, and a 200 should fail the job as a privacy regression. Today the probe only prints the code.
2. **Assert the deploy through the API**, using the existing `NETLIFY_AUTH_TOKEN` and `netlify api getDeploy`:
   - `state == ready`
   - `available_functions` contains `intel` (and `sync`, `diag`, the nightly function)
   - `function_schedules` lists the nightly cron
   - the summary shows "2 redirect rules" and "9 header rules" processed
3. **Server-side self-test via a `deploySucceeded` event function.** Netlify invokes it internally, so it is not behind the wall. It checks which env vars are present (booleans only, never values) and does a Blobs round trip. It writes `selftest/<deployId>` to Blobs. CI then reads that record with `netlify blobs:get selftest <deployId> --site …` and fails if it is missing or red.
4. **Client self-test** (§4.6) covers the real browser path the first time Sagar opens the new version.

### 5.3 Protected-main flow (current state, read via the GitHub API)
- **Current ruleset** "Protect main": active, no bypass actors.
  - Blocks deletion and force-push.
  - Requires a PR with 0 approvals.
  - Requires the checks "Types, lint, unit tests, build" and "Browser tests (phone and desktop)".
  - `strict_required_status_checks_policy: false`. That is fine solo; turn it on only if stale-base merges ever bite.
- **Gap:** new jobs (preview deploy, self-test) should **not** become required checks, because forks and Dependabot cannot run them.
- **Gap:** the main-branch run repeats the full end-to-end suite after the PR already passed it. This is free on a public repo, so keep it as the deploy gate.
- I could not read the `production` environment protection (403 through the proxy).

---

## 6. Other connectors: what I accept and reject

| Connector | Finding | Verdict |
|---|---|---|
| **Netlify MCP** | Reads project, deploys, extensions, observability; coding context for every primitive | **Keep; it is the RCA tool.** Its blind spots: no credit usage, no Blobs reader, no env values (good). |
| **GitHub (gh CLI)** | Reads runs, rulesets, artifacts | Keep for CI forensics. Remember the repo is public. |
| Supabase | Org "Yoshimitsu", free, no projects | Rejected (see §2). Revisit only if 2.0 grows multi-user or realtime features. |
| Cloudflare | Account with no Workers or D1; R2 not enabled; this MCP server is deprecated | Rejected (second perimeter). |
| **Vercel** | A Vercel project **`zanshin`** exists (`prj_GBrNJFdUPJyXX3SVF40rqaprKYAi`, scope `sagar-6ba6`, created about 2026-10-30 13:32 UTC, `updatedAt` 0.1 s after creation, so probably never deployed). The connector is not authorized for that scope, so I could not inspect it. | Rejected as a platform. **Sagar: confirm it has no public deployment and delete it if unused.** A public copy would sit outside the SSO wall. |
| Postman | Free account (1,000 monitor runs/month) | Rejected. Its monitors run from Postman's cloud and hit the 401 wall. The intel contract is already unit-tested through `createIntelHandler`. Put the sync and diag request/response contracts in shared Zod schemas and Vitest instead. |
| Airtable | Reachable (ping) | Rejected: no fit, and it would move personal data to another vendor. |
| Netlify extensions (Neon/Netlify DB, Supabase, Auth0, Async Workloads, Arcjet, CSP nonce, analytics…) | Catalog only; none needed | Rejected for 2.0. The CSP-nonce extension is unnecessary because the CSP already allows `'self'` scripts only. |
| Netlify Agent Runners / AI Gateway as the main coach | — | Rejected on Free: they consume the same 300 credits that keep the site up. Revisit AI Gateway on Personal/Pro if a non-search model (e.g. Claude) is wanted for the coach without a second API key. If so, add the gateway's cost to the same daily-cap ledger. |

---

## 7. Security housekeeping found along the way
- The Netlify account has **`mfa_enabled: false`**, and the team does not enforce MFA. Login is via Google, so the Google account's 2-step verification is the real lock on all private data and Perplexity spend. **Sagar: confirm Google 2SV is on, and consider turning on Netlify MFA.**
- `NETLIFY_AUTH_TOKEN` is a personal access token with full account rights, stored in GitHub secrets. Give it an expiry and rotate it. With sync, that token also reaches the encrypted store; ciphertext only, but still worth rotating.
- The function env-var budget is about 4 KB in total. Adding `EWGF_API_KEY` and a Tekken ID is fine; keep it lean.

---

## 8. Ranked recommendations

1. **Credit guard** (free, urgent): release-gated production deploys, PR draft previews, conditional monthly media deploy, pinned netlify-cli. Optionally Personal at $9/month with auto-recharge.
2. **Telemetry** (free): `diag` function, `ZT1` log lines in intel, a nightly 7-day digest line, hidden source maps. This gives Claude autonomous RCA through the observability connector.
3. **Sync** (free, <1 credit/month): Function + Blobs, end-to-end encrypted per-device op log, last-writer-wins per record by HLC, context-scoped store, pairing code.
4. **Scheduled** (free): Netlify nightly function for ewgf.gg ranked matches and the public morning brief; GitHub Actions nightly Wavu diff that opens a PR.
5. **Post-deploy verification without SSO**: 401 assertion, deploy-API assertions, `deploySucceeded` self-test read back from Blobs.
6. **Fix the spend-cap race** (per-call ledger keys).

## 9. What needs Sagar
- Check Netlify Usage & billing (balance and reset date). Decide Free with release-gated deploys, or Personal ($9/month) with auto-recharge.
- Confirm Google 2SV; optionally enable Netlify MFA. Give the Netlify PAT an expiry.
- Create an ewgf.gg account and API key. Add `EWGF_API_KEY` (and his Tekken ID) as Netlify env vars.
- Add a fine-grained GitHub PAT or App token secret for the Wavu-diff bot, so CI runs on its PRs.
- Check or delete the orphan Vercel project `zanshin`.
- No toggles are needed for Blobs, scheduled or background functions, or previews. Previews are already behind SSO.

## Sources
- Netlify MCP: get-user, get-teams/get-team, get-project, get-deploy-for-site, get-extensions, observability get-counts/get-topk/get-request-logs/get-request-detail, coding context (functions, blobs, database + operational-footguns, ai-gateway, access-control + two-layer-pattern, deploy, identity, forms).
- [How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) · [Credit-based plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) · [Pricing](https://netlify.com/pricing.md) · [Pricing changelog](https://www.netlify.com/changelog/netlify-pricing-update-introducing-credit-based-plans.md)
- [Observability overview](https://docs.netlify.com/manage/monitoring/observability/overview/) · [Function logs](https://docs.netlify.com/build/functions/logs) · [Env vars](https://docs.netlify.com/build/environment-variables/overview/)
- [Netlify DB billing](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/) · [Sleep on inactivity](https://docs.netlify.com/build/data-and-storage/netlify-database/configure-sleep-on-inactivity/)
- [Site protection vs app login KB](https://www.netlify.com/knowledge-base/netlify-auth-site-protection-app-login-or-team-sso.md) · [Private-by-default projects](https://www.createwith.com/tool/netlify/updates/netlify-adds-private-by-default-projects-with-separate-preview-visibility-contro) · [AI Gateway changelog](https://main--www.netlify.com/changelog/tag/ai-gateway.md)
- [ewgf.gg API docs](https://ewgf.gg/api-docs)
- Supabase docs (Project Pausing, Production Checklist) via Supabase MCP; Cloudflare D1 pricing via Cloudflare MCP.
- GitHub API (read-only): runs, ruleset 26276635, artifacts.
- Blocked during research (permission not granted in time): `docs.netlify.com/.../project-visibility/` and `api.netlify.com/api/v1/ai-gateway/providers/detailed`.
