# 1.4 Redesign — UX audit

**Persona:** UX auditor. **Method:** every route (24) rendered from the 1.3.0 build on a phone (412 × 915) and a desktop (1440 × 900), with seeded training data (8 match sets, 3 sessions, drill sets, problem moves, a primer) and synthetic bundled media in Wavu's shapes: transparent 1080-wide portrait renders (3:4, 4:5, 2:3, 1:1, 9:16), square 128 px icons, 16:9 clips. Every figure carries a HEAD marker at the top and FEET at the bottom, so a crop is unmissable. The harness also measures, for every `<img>`, how much of the picture its box shows. Sagar's two screenshots (Today hero, desktop Move Explorer) were the starting reports.

## Measured: art is cropped

| Where | Box (desktop) | Picture shown |
| --- | --- | --- |
| Today hero (Yoshimitsu portrait) | 858 × 238 | **21 %** (phone: 31 %) |
| Character page hero (Kazuya, 2:3) | 926 × 238 | **17 %** (phone: 28 %) |
| Character icons (Matchups, Log list) | 34 × 42 | 81 % |
| Character icon (Log form) | 52 × 64 | 81 % |

Cause: every frame uses `object-fit: cover` in a box whose shape has nothing to do with the art. Heroes are 4:1 letterboxes around 3:4 renders, so cover keeps a horizontal band through the chest. Icons are 5:6 boxes around square art.

## Readability of frame data

1. **No key anywhere.** `i23`, `−9`, `+4c`, `(+7)`, the `M`/`H`/`L` chips, the tier icons and the status badges are never explained in the app. A new player cannot tell which number is "on block" and which is "on hit", what the letters mean, or why some values are orange.
2. **No column labels.** The Move Explorer row is `input · name · level · startup · block · hit · clip · status · stance` with no header and no labels; the order is the only clue.
3. **Tier icons sit on their own line** above each number (a global `svg { display: block }` reaches into the inline value), which is the "stacked, chaotic" look in the screenshot.
4. **Rows have no grid.** Columns start wherever the previous item ended, so values never line up down the list; long names push everything right; the status badge wraps under the row on half the moves.
5. **Data bug:** three names carry raw HTML entities (`Enma&#039;s Flame`, `Enma&#039;s Cleansing Sword`, `Enma&#039;s Soul Blade`) and one carries `&gt;` (`Wheel of Arrows &gt; Sword Stab`). The importer stores Wavu's text undecoded.
6. Filters take 1.5 phone screens before the first move (29 chips in 6 rows, always open).
7. The `c` suffix has two meanings in the code: the tooltip says "recovers crouching", the spoken label says "opponent crouching" (the spec's meaning).

## Look and feel

1. **One shape for everything.** Every screen is a single column of identical dark rounded rectangles with a hairline border. Hierarchy comes only from headings; nothing is featured, nothing recedes. This is the "tile-y, blocky" complaint.
2. **No imagery outside two heroes.** The 228 bundled images (41 icons, 33 portraits, 154 clips) appear only as a cropped Today hero, a cropped character hero and 36 px icons. Backgrounds are a flat `#0E0F11`.
3. **One colour scheme.** Dark or light, no character. Accent colour is effectively absent (the seal red is reserved for the logo).
4. **Typography is flat.** Card titles, section titles and body differ by a few pixels; display type is used only for page titles.
5. **Walls of text:** Patch Watch re-verification, Heat, Playbook counterplay, the primer — long prose in one undifferentiated block.
6. **Matchups** is 42 identical full-width cards (five phone screens of "Record: 0–0 (0 games)").
7. **Path** overflows horizontally on phones (stage columns run off-screen with no scroll affordance).
8. **Today** shows the plan as a list of boxed rows with raw engine strings ("mastery 0.00, never practiced"; "Lows blocked: 0.4 vs target 0.5 → (14.666666666666668 in sample)").
9. **Log form**: 14 steppers in one column; no grouping by what happened (punishes, defence, Heat).
10. Phone **onboarding** renders at desktop scale inside a narrow card.

## Keep

The token discipline (no colour literals outside `tokens.css`), the repository/screen boundaries, the `DataBadge` provenance model, never-colour-only signals, 44 px targets, Lab Mode scaling, reduced-motion handling, and the offline-first media library all stay. The redesign is a skin and layout change over the same data and services.
