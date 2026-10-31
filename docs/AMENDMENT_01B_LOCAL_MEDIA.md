# ZANSHIN 1.1.0 — Amendment 01B: local media library

Amendment 1 asked for Tekken 8 imagery in the app. 01B is the version that shipped: a **local media library**. Sagar builds a media pack on his own computer with `make_zanshin_media_pack.py` (icons, portraits and move clips from Wavu Wiki) and imports it in **Settings → Images and clips**. The app stores the files in the browser's IndexedDB and shows them across the screens. The app never downloads media itself, and the deployed site contains no game art, so nothing changes for anyone who has not imported a pack.

Base: source at `bbb2664` (1.0.0, schema v3). Result: 1.1.0, schema v4.

## What Sagar sees

| Where | What appears once a pack is imported | Without media |
| --- | --- | --- |
| Today | Yoshimitsu's portrait as a hero band, date on a plate | Unchanged |
| Onboarding welcome | Same hero | Unchanged |
| Matchups, Match Log, Log form, Punish Trainer opponent picker | Character icons beside names; initials tiles for characters without an icon | Unchanged |
| Character page | That character's portrait hero with the name on a plate; "Watch clip" on each problem move | Unchanged |
| Codex move detail | A Clip card: play/pause, 0.25×/0.5×/1×, −1f/+1f, loop | Card absent |
| Codex move list | "▶ Clip" marker on rows that have a clip | Unchanged |
| Lab drill card | Clip of the drill's moves (picker when several) | Unchanged |
| Punish Trainer | Opponent's move clip above the question, answer clip in the explanation | Unchanged |
| Flashcards | Clip on the back, after Reveal (never on the front, so it can't give the answer away) | Unchanged |
| Progress | Rank badges beside current and target rank (if imported) | Text only |
| Settings → About | The game logo (if imported) and the credit line | Text only |
| Diagnostics | Media library card: counts, size, items not matched to the app | "No images or clips imported" |

Clip keys while a clip is focused: **Space or K** play/pause (K only in Lab drills, where Space stays "next block"), **comma / period** step one frame at 60 fps. Digits are never taken, so Lab logging and flashcard grades keep them. Clips are muted, looped and `playsinline`; they autoplay only when at least half visible, only one at a time, never under reduced motion, and never when autoplay is off.

Safe Mode shows no imported art (it is the minimal recovery shell); the library is untouched and comes back when Safe Mode is off.

**Settings → Images and clips:** import a media pack; add one file for any slot (portrait, icon, clip, rank badge, logo, key art); show or hide all art; ink tone (grayscale) for still images; autoplay; default clip speed for the Codex (1×) and the Lab (0.5×); what is stored, with per-item delete and source links; export the library as a media pack; delete all (type DELETE); credits.

## Media pack format (`zanshin-media-pack`, version 1)

A zip with `manifest.json` plus the files it lists:

```json
{
  "format": "zanshin-media-pack",
  "version": 1,
  "createdAt": "2026-10-31T09:00:00Z",
  "items": [
    {
      "file": "clips/0123-yoshimitsu-1-2.mp4",
      "kind": "move-clip",
      "subjectKey": "move:Yoshimitsu-1,2",
      "mime": "video/mp4",
      "bytes": 201234,
      "sha256": "…64 hex…",
      "width": 640, "height": 360,
      "sourcePage": "https://wavu.wiki/w/File:…",
      "credit": "© Bandai Namco Entertainment Inc., via Wavu Wiki"
    }
  ]
}
```

- Kinds: `character-icon`, `character-portrait` (subject `character:<roster name>`), `move-clip` (`move:<Wavu Move.id>`), `rank-badge` (`rank:<rank>`), `game-logo` (`app:logo`), `key-art` (`app:key-art`).
- Every item is checked before it is stored: kind fits subject, MIME fits kind (clips MP4/WebM/MOV; images PNG/JPEG/WebP/GIF/AVIF), at most 300 MB, byte count and SHA-256 match. Failures are skipped and listed; the rest import.
- Unknown fields are ignored and nullable fields may be null, so packs from newer scripts still import.
- Importing the same kind and subject again replaces the old item and deletes its bytes in the same transaction.
- Entries are unzipped one at a time. The zip itself is read into memory, so the script splits packs at 100 MB by default (`--max-zip-mb`).
- Portraits and key art get downscaled copies (320/640/1080 px; WebP where the browser can encode it, else PNG) on import; screens pick the smallest copy that is sharp at the device's pixel ratio.

## Making a pack

```
python make_zanshin_media_pack.py                      # icons + portraits for the roster, every Yoshimitsu clip
python make_zanshin_media_pack.py --opponents all      # plus opponents' punishable-move clips (separate zips)
pip install pillow                                     # optional: portraits shrink to 1080 px WebP
```

Python 3.8+, standard library only. Downloads are cached in `.zanshin-media-cache`, so re-running after a patch fetches only changed files. Import every zip it writes, on every device (each browser keeps its own library).

## Home-screen install on the private Netlify site

- `VitePWA({ useCredentials: true })` puts `crossorigin="use-credentials"` on the manifest link. Browsers fetch the manifest without cookies by default; behind Netlify's sign-in that request got the login page, so the browser refused to install.
- `npm run build` now runs `rasterize-icons` first (`prebuild`), so `icons/app-192.png`, `app-512.png`, `maskable-512.png` and `apple-touch-180.png` always exist in `dist`. The manifest referenced them, but the source had no copies.
- `index.html` links the Apple touch icon and sets the home-screen title.
- `public/_redirects` serves `index.html` for every path, so reloading a deep link such as `/today` works before the service worker is installed.

## Data model

- Dexie schema **v4** adds `media: 'id, kind, subjectKey, importedAt'` and `mediaBlobs: 'key'`. Upgrading from v3 takes the usual pre-migration snapshot, keeps every row, and starts both tables empty.
- `media` rows: `{ id: "<kind>|<subjectKey>", kind, subjectKey, mime, bytes, sha256, width?, height?, blobKey, variants?, origin: 'pack'|'file', sourcePage?, credit?, importedAt }`. Bytes live in `mediaBlobs` as `Uint8Array` (D-059: fake-indexeddb does not round-trip Blobs).
- Only `mediaRepo` touches the two tables. A row and its bytes are written and removed in one transaction.
- Settings gain optional `mediaShowArt`, `mediaInkArt`, `mediaClipAutoplay`, `mediaClipSpeedCodex`, `mediaClipSpeedLab`; absent means the defaults (on, off, on, 1, 0.5), so 1.0.0 settings rows stay valid.
- A small index of which items exist is kept in memory and in `localStorage` (`zanshin:media-index`), so screens decide synchronously whether to reserve space for art (no layout shift) and never touch the database when nothing was imported.

## Decisions (append to DECISIONS.md)

| Id | Decision | Why |
| --- | --- | --- |
| D-01B-1 | Media is imported locally; the app never fetches it and the site ships none | Sagar's choice of Muse's Option B; works offline and behind the private site |
| D-01B-2 | Media is left out of the JSON backup and of Reset; Export media pack and Delete all media handle it | A backup must stay small enough to export often; resetting training data should not wipe a 30 MB+ library |
| D-01B-3 | Art components render nothing (not even a box) until media exists; icons show initials tiles only once at least one icon is imported | The app looks exactly like 1.0.0 for anyone without media |
| D-01B-4 | Space plays clips except in Lab drills; K and comma/period always | Lab Mode owns Space ("next"); digits stay with logging and grading |
| D-01B-5 | Ink treatment is a grayscale filter on still images, never on clips | Clips' Heat effects and hit sparks carry information |
| D-01B-6 | Startup integrity checks count `mediaBlobs` without loading it; a new `media` check repairs rows and bytes that disagree, reading keys only | The record check used to load every table whole, which with media would read the whole library on every launch |
| D-01B-7 | Text over art sits on `--art-plate` (90% `--bg`); `--text-3` is not used on plates | Keeps `--text-1`/`--text-2` at 6.5:1 or better over any image (test in `contrast.spec.ts`) |

## Not done from Amendment 1 (deliberately, or left for later)

- No bundled or remote media and no resolver fallback chain (01B replaces it with the local library).
- No focal-point editor; heroes crop at 50% / 25%.
- No `user-capture` kind for PS5 captures attached to match sets; "Add one file" covers single images and clips.
- No clip posters or thumbnails; rows show a "▶ Clip" marker instead.
- No mute toggle (Wavu clips have no audio track).

## Tests added

- Unit (56 new, 790 total): `tests/unit/media/` covers subjects, the repository and consistency repair, pack import/export round trip and every rejection path, the v3→v4 migration, the components (fallbacks, art off, Safe Mode, ink, clip speed, frame step, keyboard, picker) and startup integrity with media. Plus the art-plate contrast check and the integrity check count.
- End to end: `tests/e2e/media.spec.ts` (phone and desktop) imports a generated pack (grayscale placeholder PNGs, stand-in clip bytes), checks every placement, CLS ≤ 0.05 on Today and Matchups, axe on Settings → Images and clips and on Today, reload persistence, art off, a bad file, and export → delete all → re-import.

## Also fixed

- Consecutive toggles in one card ran into each other (Settings → Lab defaults and Data, and the new Display card). `.z-toggle` is now one per line.

## Notes for the next session

- After `npm install` the lockfile gains `fflate` 0.8.2 (the zip reader and writer; it loads only with the Images and clips screen).
- Seen once in four full unit runs: an unhandled `DatabaseClosedError` reported after the last test in `tests/integration/lab.spec.tsx`, with every test passing. It looks like a teardown race (a Lab write still in flight when the next test closes the database) and did not reproduce in six isolated runs.
- `defaultSettings()` sets snapshotsKeptDaily 30, snapshotsKeptEvent 90 and backupReminderDays 7, while the build reference says 7, 5 and 14. Nothing reads these fields yet. Unchanged in 1.1.0.
