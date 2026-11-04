# ZANSHIN 2.0.0-beta.2 — Imagery and motion everywhere, and reloads that pick up the new version

Base: 2.0.0-beta.1 (`eb41013`). Schema **v6, unchanged**. Second of the three 2.0 releases (`docs/v2/PLAN.md`): M6
Imagery, moved ahead of M4 and M5 at Sagar's request on 2026-11-03 ("make sure art and imagery including visuals
with motion is effectively done throughout the website"). M4 (Lab 2.0) and M5 (input and voice) move into
Release 3 with M7 and M8, so 2.0 still costs three production deploys.

## What changed for Sagar

### Reload picks up the new version

- After a deploy, a page you have not touched (no taps, no typing, no Lab session) applies the waiting update and
  reloads once by itself, at most once a minute. A page you are using still shows the "New version" toast. No more
  unregistering the service worker by hand.

### Every character has art

- The nine characters Wavu Wiki has no portrait for (Anna, Armor King, Bob, Clive, Eddy, Heihachi, Kunimitsu, Miary
  Zo, Fahkumram) now show the official Tekken 8 render, credited to Bandai Namco. The media pack also finds art
  whose file name breaks the wiki's convention and logs every choice.
- Where a character still has only an icon, it shows as a framed medallion over a blurred wash of itself, not a
  letter.

### Halls: a stage behind every screen header

- Every screen header stands in its hub's **hall**:
  - Three ink-wash ridges drawn from a seed, so each hub has its own skyline.
  - A hub mark: a torii for Today, bamboo for Train, the moon in water for Coach, brush strokes for Study and a
    hanko for You.
  - The hub kanji (今 稽古 師 書 道) as a watermark.
  - The ridges drift slowly at different speeds as you scroll.
- Behind the ridges, a **grayscale photograph of the hub's place**, tinted by your colour scheme:
  - Today: a lone torii on a rock in the sea. Train: a tatami hall opening onto a winter garden.
  - Coach: a full moon over water. Study: sumi ink bleeding into paper. You: a corridor of torii gates.
  - **Heat** gets burning coals tinted with the Heat colours, and **Punish Trainer** gets a sword blade.
- The halls also cover the screens with their own header: Matchups, Moves and Path.
- On phones the photo rises from the bottom, so text always sits on a calm background.
- **Settings › Images and clips › Credits** names every photographer.

### The Path is a climb

- Each stage card carries a landscape that rises with the stage, from bamboo foothills through mist, the shrine
  approach and peaks in cloud to the moon over still water at Mastery.
- The open stage glows in your accent colour and locked stages are grayscale.
- A passed stage gets a seal sun in its landscape, and its hanko shows the stage numeral (一 to 十).

### Small things that make it feel made

- **Move of the day** on Today: one move from today's plan, with its clip when the pack has one.
- Cards and lists rise in one after another. Roster figures step forward on hover. Clips pause when the tab is in
  the background.
- **Empty screens have drawings:**
  - A paper lantern swaying on its cord when there are no matches yet.
  - A dojo floor when there are no sessions, and the moon over water when there are no reviews.
  - Washi sheets when there are no cards, and raked gravel when there are no practice days.
- **Flashcards are paper:** washi fibres in the light theme, deep lacquer in the dark ones. The answer rises in
  when you reveal it.
- The frame-step buttons on clips are now named "−1f, back one frame" and "+1f, forward one frame", so voice
  control can reach them.

### What turns it off

- **Settings › Show imported art and clips** off hides every photo and clip; the drawn art stays.
- Reduced motion stops all drift, sway and rise.
- Reduced transparency hides the scene art.

## How it works

- **Updates.** `src/services/updateGate.ts`:
  - `noteUserInteraction` and `shouldAutoApplyUpdate` keep a one-a-minute `sessionStorage` guard.
  - `main.tsx` calls `updateSW(true)` from `onNeedRefresh` when the page is untouched.
- **Halls.**
  - `src/components/layout/HallArt.tsx` holds `ridgePath` (mulberry32 seeded), the hub motifs and the photo layer.
  - `useHubHall()` gives any header its hall; `HallArt.css` is imported by the component.
  - One passive rAF scroll listener writes `--hall-scroll`.
  - The photo's blend, opacity and filter are tokens (`--hall-photo-*`).
  - `image-set()` with AVIF then WebP is gated by `@supports`.
  - The photo is 800 px wide below 1024 px and 1600 px above.
- **Art pipeline.**
  - `scripts/art/make_art_pack.py` runs in the Art review workflow on `art/**` branches. The sandbox cannot reach
    Unsplash.
  - Picks come from `scripts/art/picks.json`. The image URLs were obtained through the Unsplash API, which records
    each download.
  - The script writes grayscale AVIF and WebP and `src/data/art-credits.json`.
- **Caching and budget.**
  - The 800 px set is precached (305 kB).
  - `art/*-1600.*` is served stale-while-revalidate from the `zanshin-art` cache.
  - `check-bundle.mjs` budgets all art at 1.5 MB (1.35 MB now) and the 800 px set at 400 kB.
- **Path.**
  - `src/components/decor/StageLandscape.tsx`: `stageScene(index, total)` and `stageRidges(index)`.
  - `Hanko` takes a `glyph`. The kanji subset was rebuilt with 一–十.
- **Empty states.** `src/components/decor/EmptyArt.tsx`: `EmptyNote scene=…`, an aria-hidden SVG beside the text.
- **Motion.**
  - `.z-stagger` or `[data-motion="stagger"]`: transform-only `z-rise`, 40 ms steps capped at 12.
  - Every animation has an explicit reduced-motion off switch.
  - No opacity animation runs on anything axe samples.

## Tests

- **Unit:**
  - The update gate (7 tests).
  - Hall ridges are deterministic and closed. One credited photo per hub and section, with every file on disk.
    `image-set` order and fallback. Section photos fall back to the hub photo.
  - Stage scenes climb monotonically and ridges rise.
  - Empty art is aria-hidden for every scene.
  - Move of the day picks from the plan.
  - Media-pack art search scoring.
  - The kanji subset covers every kanji used.
- **End-to-end (phone, desktop, tablet):**
  - Every hub root and custom-header screen stands in a hall, and Show art off removes the photo.
  - axe is clean on every route in dark and light, across all four schemes.
  - Halls, landscapes and empty states were checked by eye in dark, light, desktop and phone.
  - Media pack import with no layout shift. The hero-size check now allows 0.05 px for sub-pixel re-rounding
    (RCA row 2026-11-03).

## Known limits (tracked for Release 3)

- M4 (Lab 2.0) and M5 (input, voice) are not in this release.
- The sync polish from beta.1 still applies:
  - There is no "reset sync" after both devices unpair.
  - Bursts of focus events are not coalesced.
  - There is no pairing QR code.
