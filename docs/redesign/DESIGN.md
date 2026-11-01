# 1.4 Redesign — art direction and design system

**Personas:** art director (look, colour, imagery), frame-data coach (the legend and how a player reads a move), frontend architect (how it is built inside the 1.3 rules), QA reviewer (a separate pass by an agent that did not build it). Input: `AUDIT.md` and Sagar's brief — no cropped art, a key for the frame numbers, a calmer move list, far more imagery, backgrounds and colour, and no more "tile-y, blocky" screens.

## Direction: "Ink and steel"

ZANSHIN is a dojo notebook for a cyber-ninja. The look pairs **sumi ink and washi** (brush strokes, ensō, seigaiha waves, a hanko seal) with **Tekken 8's steel and glow** (cut-out character renders lit by their colour, Heat's violet energy, ember sparks). Every screen sits on a scene, not a flat fill: a deep gradient, a faint wave pattern, and — wherever a character is in play — that character's full render standing at the edge of the screen, faded into the dark.

Content floats above the scene on **glass panels** (translucent, blurred, a lit top edge) instead of identical bordered boxes, and not everything is a panel: page headers, timelines, stat rows and grids sit directly on the scene. One element per screen is **featured** (a stage hero, a primer, the next drill); the rest recede.

## Colour schemes

Settings → Appearance: **Theme** (System / Dark / Light) as before, plus **Dark scheme**:

| Scheme | Feel | Accent / second accent |
| --- | --- | --- |
| **Manji Night** (default) | blue-black lacquer, Yoshimitsu's cyan armour glow | cyan `#4CC9F0` / ember `#FF8F4A` |
| **Crimson Dojo** | black lacquer, vermilion and gold | vermilion `#F0545A` / gold `#E2AE4A` |
| **Heat Surge** | Tekken 8 Heat: violet energy on midnight | violet `#A898FF` / electric `#5FD0FF` |
| **Washi Daylight** (the light theme) | warm paper, sumi ink, seal red | seal `#B32D1C` / indigo `#1F4E8C` |

Signals keep one meaning each in every scheme (green = plus on block/hit, orange = punishable, red = launch-punishable, pink = low, violet = Heat, amber = unverified), retuned per scheme. Every text and signal colour was checked against every surface of its scheme: **all pass WCAG AA (≥ 4.5 : 1); the worst case is 6.16 : 1** (`text-3` on Washi surface). Controls are ≥ 3 : 1.

## Imagery

- **Scene art** (`SceneArt`, in the shell): the screen's character — Yoshimitsu by default, the opponent on a character page, the subject of a primer — as a full cut-out render, bottom-right, ~90 % of the viewport height on desktop, masked into the background, 22 % opacity (12 % on phones, behind glass). Decorative only (`aria-hidden`), never cropped: `object-fit: contain`, anchored to the bottom.
- **Stage hero** (replaces the letterbox hero): the render stands at full height on the right of a 300–400 px stage, over a blurred, colour-washed copy of itself (ambient glow), a floor shadow and the wave pattern; title and actions sit on the left. The figure is never cropped — the stage is sized to the art, not the other way round.
- **Character select grid** for Matchups: tall portrait tiles (3:4) with the whole render, the name on a nameplate, the record as a small ring.
- **Ornaments** (original SVG, drawn for ZANSHIN, coloured by tokens): ensō, brush stroke underline for section titles, seigaiha and asanoha patterns, katana divider, hanko seal, ember particles. No game logos or emblems are reproduced.
- **Icons**: square frames, `contain`; the initials fallback stays.

**Media fit rule** (enforced by an end-to-end test): an `<img>` may use `object-fit: cover` only when its box matches the picture's shape within 8 %, or when it is marked `data-ambient` (a blurred decorative copy). Everything else is `contain`.

## Typography

Display (Shippori Mincho B1) for page titles, section titles and the stage hero, larger: page 32/40 phone → 44/52 desktop, section 22/28. An **eyebrow** (12 px, 0.14 em tracking, uppercase, accent colour) above featured titles. Body 15/22 and 17/26 unchanged. Numbers stay IBM Plex Mono, tabular.

## Frame data: the legend and the move list

**Frame-data key** (`FrameLegend`), written by the coach persona from the definitions the app already ships (spec §4.7) — nothing new is invented:

- **Startup `i13`** — frames until the move can hit. Lower is faster; `i10` is jab speed. `i17~18` is a range.
- **On block `−9`** — frame advantage after the opponent blocks. Minus means you recover later. Tiers: **+1 or better** your turn · **0 to −9** safe · **−10 to −14** punishable · **−15 or worse** launch-punishable.
- **On hit `+4`** — frame advantage after the move hits.
- **Letters after a value** — `a` opponent airborne · `b` recovers back-turned · `c` opponent crouching · `d` downed · `g` opponent can guard during recovery · `s` stagger · `w` wall crush.
- **A second value in brackets** `(+7)` — the second value Wavu Wiki publishes for that move; open the move for its notes.
- **Hit levels** — `H` high (duck it) · `M` mid (block standing) · `L` low (block crouching) · `sm`/`sl` special mid/low · `T` throw · `!` unblockable. A capital letter hits grounded opponents.
- **Status** — Verified (you checked it in Practice) · Sourced · Conflicting (sources disagree; tap to compare) · Unverified · Web-sourced.
- **Stances** — every abbreviation with its name, from the stance pack.

It opens above the Move Explorer (expanded the first time, then remembered), as a sheet from a "How to read this" button on the move list, move detail, Punish Trainer and Heat, and every value carries a native tooltip and a spoken label.

**Move list**: a real grid with a sticky column header on desktop (`Input · Move · Level · Startup · On block · On hit · Status`), values aligned down the column, tier icons inline with their number, status as a compact icon badge. On phones each move is a two-line row: input and name, then labelled stat pills (`START i23 · BLOCK −9 · HIT +4c`) — labelled, so the legend is a reference, not a requirement. Filters move into a collapsible panel with an active-filter count. HTML entities in names are decoded in the importer and in the bundled pack.

## Build rules (architect)

- Colours only in `tokens.css`: each scheme is a `[data-scheme]` block; patterns are SVG data-URI tokens used as masks so their colour comes from tokens.
- Screens never fetch; art comes through the existing media hooks.
- `prefers-reduced-transparency` → solid panels; `prefers-reduced-motion` → no ember drift; scene art follows the existing "Show art" setting.
- Shell bundle budget unchanged (200 kB gz); ornaments are inline SVG components, patterns are a few hundred bytes each.
- Existing tests keep passing; new e2e: media-fit rule on every route, legend present and correct, scheme switch, axe on every route in every scheme.

## Release plan

1. **1.4.0 foundation** — schemes, scene, glass panels, stage hero, icon fit, legend, move list, entity fix.
2. **1.4.0 screens** — Today, Matchups grid, character page, Path, Lab, Punish, Cards, Log, Progress, Coach, Patch, Settings, onboarding.
3. **Independent QA** — a reviewer agent screenshots everything in every scheme and reports; fixes; release notes; deploy.
