# ZANSHIN 2.0.0-beta.1 — Five hubs, ranked matches that sync themselves, and a phone that shares your PC's data

Base: 1.4.1 (`f4d858f`). Schema **v5 → v6** (two new tables, `syncOutbox` and `syncMeta`; nothing existing changes;
the pre-migration snapshot guard runs as before). First of the three 2.0 releases (`docs/v2/PLAN.md`): M0 release
gate, M1 shell, M2 ranked sync, M3 device sync, plus the SSO Option B lock.

## What changed for Sagar

### Getting around (M1)

- **Five hubs** instead of a long menu: **Today · Train · Coach · Study · You.** On the phone a floating dock with
  Coach in the centre ring; on the tablet a slim rail; on the desktop a rail tree that collapses to icons with `[`
  and remembers its state. Every screen is within two taps of any hub. Old URLs still work.
- **Ctrl/Cmd+K (or `/`, or the phone's search button)** opens a command palette: continue what you were doing,
  recent screens, actions, and go-to by name — moves by name or notation ("flash", "1+4"), stances ("KIN"),
  characters, combos, Path nodes, playbook entries, log sets. When nothing matches it offers Ask the coach or Look
  it up. It is off inside Lab Mode and inside text fields.
- **Lab Mode** has its own strip (block, timer, press-and-hold Exit) and no navigation, palette or shortcuts, and
  leaving it leaves fullscreen again.
- **"Ask the coach about this"** on a move, a character, a logged set and a session debrief opens Coach › Ask with
  that context filled in.
- Badges: Train shows how many cards are due; Coach, Study and You show a dot when there is something new.
- Fixes that mattered: a Stage 1 node practised after Stage 0 was passed is no longer saved as locked; coach
  citation chips open the right move page; Heat, Stances and Patch Watch are reachable; the kanji in the ensō and
  seal no longer fall back to a system font.
- **Telemetry you control.** When something breaks, the app can send a short, sanitized report (route, status,
  fingerprint — never your data or keys) to the site's own `diag` function. Settings › Telemetry switches it off.

### Ranked matches (M2)

- Enter your **Tekken ID** in Settings and press **Sync ranked** on the Match Log: your ranked games arrive from
  Wavu Wank, grouped into sessions, each already a match set (no more pasting). Re-syncing never duplicates.
- **Progress** shows your rank and rating trend, and where your rank band sits against your Path stage.
- A **session protocol** on the log: a pre-queue focus, a stop-loss prompt after three straight losses, a reset,
  and a thirty-second reflection card when the session is over.
- Every message the function can send has its own copy, and each points you at the fix: wrong device key →
  Settings; unknown Tekken ID → Settings; too many syncs → wait a minute; Wank unreachable → your log is unchanged.

### Your PC and your phone, one log (M3)

- **Settings › Devices.** On the first device press **Set up sync on this device**: it shows a pairing code once.
  On the other device press **Join with a code** and type it (spaces, dashes and case do not matter). From then on
  everything you log, review or change on one device appears on the other: on open, when the app comes to the
  front, when the connection returns, and a few seconds after any change.
- **End-to-end encrypted.** The pairing code is the only secret and it never leaves your devices. Each device
  derives its keys from it; the server (Netlify Blobs) stores only ciphertext, a hash to recognise the pairing,
  and bookkeeping that holds no content. Nobody with access to the server can read your log.
- **Conflicts resolve themselves.** Logged sets, reviews, assessments and notes merge as a union; profile, settings,
  card states and the like take the latest change by a hybrid logical clock, so two devices with different clocks
  still agree. Mastery is recomputed after a merge, never synced.
- **What stays on each device:** the AI API key and any other secret-shaped setting, the media library, error
  reports and derived state. Settings arriving from the other device never overwrite this device's key.
- **Status you can read:** "Synced 2 min ago", "Syncing…", "Offline — changes are saved and will sync", "Signed out
  — sign in again to sync", "N changes waiting", a **Sync now** button and **Unpair this device** (data stays).
- **Ranked sync needs no separate key any more.** Pairing gives both devices the same device key; the Ranked sync
  card says so and shows its last four characters.

### The hourly sign-in goes away (SSO Option B)

Until now every function and every page sat behind Netlify's team sign-in, which expired about every hour. From this
release every function that touches your data — ranked, coach intelligence, error reports — is locked to your
paired devices instead: a device sends its key in a header, the server compares its hash with the hash that pairing
registered. The app shell itself can therefore be opened without the Netlify sign-in. The switch is thrown by hand
after both devices are paired on this deploy (so nobody can register a pairing before yours), and PR previews stay
behind sign-in.

## How it works

- **Shell.** One pure `hubFor(pathname)` decides every highlight; per-hub position is remembered in
  `sessionStorage`; the palette's content index is built lazily from the packs. All colours stay derived tokens.
- **Ranked.** `netlify/functions/ranked.mts` → `src/server/ranked/handler.ts`: fetches Wank's player page and
  replay windows one request at a time with a polite delay (ewgf as fallback when `EWGF_API_KEY` is set), parses
  with fixture-tested parsers, caches in Blobs, and returns normalized battles. The client dedupes on
  `importRef = battle_at:p1:p2`, groups into sessions and recomputes the protocol state.
- **Sync server.** `netlify/functions/sync.mts` → `src/server/sync/handler.ts`, store scoped per deploy context.
  Auth is `X-Zanshin-Sync: <authKey>` compared in constant time with SHA-256 in `v1/verifier`. Routes: `POST init`,
  `GET state`, `PUT log/<deviceId>/<hlc>` (write-once), `GET log?device=&after=&limit=` (**one cursor per writer** —
  a single global cursor over device-prefixed keys skipped entries), `PUT snap/<hlc>` (`{cursor, data}`, newest three
  kept with their cursor metadata), `GET snap/<hlc>`, `POST ack` (per-writer map, merged max). Compaction deletes a
  writer's entry only when every other known device has acked past it **and** the newest snapshot covers it.
- **Sync client.** Schema v6: `syncOutbox` (append-only queue) and `syncMeta` (per-record HLC, tombstones, clock,
  device, per-writer cursors, pairing). Every repository write on a synced table captures into the outbox in the
  same Dexie transaction (`withSyncCapture`), and only once paired; `applyRemoteChanges` merges incoming changes
  without re-capturing and keeps this device's secret-shaped settings; `captureExisting` queues records written
  before pairing. `src/services/sync.ts` pushes batches (≤ 500 changes / ≤ 512 KB plaintext), pulls per writer,
  acks, snapshots every 200 batches or 7 days, bootstraps a joiner from the newest snapshot, and runs everything
  under one mutex with 30 s → 10 min backoff. Crypto in `src/domain/sync/crypto.ts`: HKDF-SHA-256 from the pairing
  secret (`enc`, `auth`, `device`), AES-GCM-256 with a 12-byte IV and AAD, `v1.<iv>.<ct>` on the wire, Crockford
  pairing codes with a checksum.
- **Device lock.** `src/server/deviceKey.ts`: the allow-list is `ZANSHIN_DEVICE_KEY_SHA256` (optional) union the
  hash `POST init` stored at pairing (`v1/devicekeyhash`, written once, never overwritten); no hash at all fails
  closed (503 `device-key-unset`); a missing or wrong key is 401 `device-key`, which the app tells apart from
  Netlify's HTML 401. `ranked`, `intel` and `diag` all use it; `sync` keeps its own auth.

## Tests

- Unit (1,270+): route and hub tests; palette index; stage-lock regression; ranked parsers on saved Wank HTML and
  replay JSON, dedupe idempotence, protocol state; HLC and merge laws; crypto round-trips and parity of the two
  derivation paths; sync server (per-writer regression "A writes, B reads, A writes, B reads", paging, ack
  merge-max, compaction blocked by a lagging device or an uncovering snapshot, snapmeta retention); sync engine
  with two fake-IndexedDB databases (convergence incl. three devices and 2 h clock skew, tombstones, idempotent
  replays, pre-join data, join after compaction, aiApiKey never in a body, 401 queue); device-lock allow-list and
  every function's 401/503 path; `deviceKeyHash` registered once and never overwritten.
- End-to-end (phone, desktop; regressions also on tablet): dock, rail, palette, Lab strip; ranked import with a
  mocked function and every error kind; `sync-pairing.spec.ts` and `m3-regressions.spec.ts` against the **real**
  sync handler behind `page.route` — pair, join from a second browser context, both directions of data, every
  request body one of the four protocol shapes with no secret field, the header is the derived key and never the
  code, a paired device opened while the server hangs still shows as paired, unpair keeps data; axe clean in dark
  and light on every new screen; 44 px targets.

## Known limits (tracked for beta.2)

- If both devices unpair there is no "reset sync" yet: re-pairing needs the server's old verifier cleared by hand.
- A burst of focus/online events queues several syncs instead of coalescing to one.
- The QR code for the pairing code is not shown; the code is typed (it is short and checksummed).
