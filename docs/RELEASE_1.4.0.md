# ZANSHIN 1.4.0 — Redesign: "Ink and steel"

Base: 1.3.0 (`e5b4b6c`). Schema unchanged (v5); one optional Settings field (`scheme`).

Sagar's brief: art was cut off (the Today hero), the move list's numbers had no key and the list was hard to read, and the app needed far more imagery, backgrounds and colour instead of a "tile-y, blocky" look. Planned and built by persona — UX auditor, art director, frame-data coach, frontend architect, and an independent QA reviewer who had not seen the work. The plan is in `docs/redesign/AUDIT.md` and `docs/redesign/DESIGN.md`.

## What changed for Sagar

- **Nothing is cropped.** The Today hero used to show 21 % of Yoshimitsu's render on a desktop (31 % on a phone) and the character page 17 %. Heroes are now stages: the whole figure stands on the right at full height over a blurred, colour-washed copy of itself. Icons are square. Matchups is a character-select grid of full portraits.
- **The frame numbers have a key.** "How to read frame data" sits above the move list (open the first time, then remembered) and on every move page: startup, on block and its four tiers (plus, safe, punishable, launch-punishable), on hit, the letters after a value, bracketed second values, hit levels, the data badges and every stance. Every value on a phone is labelled (START · ON BLOCK · ON HIT · LEVEL); on a desktop the list is a real table with a sticky header and aligned columns. A move page opens with its four numbers in large type and what they mean ("punishable").
- **Colour schemes.** Settings → Appearance: Manji Night (blue-black, cyan and ember; the default), Crimson Dojo (black lacquer, vermilion and gold), Heat Surge (Tekken 8 violet) and Washi Daylight (the light theme). They apply as you pick and persist.
- **A scene behind every screen**: deep gradients, faint seigaiha waves, film grain, drifting embers, a brush ensō, 残心, and the screen's character standing at the edge — Yoshimitsu, or your opponent on a character page. Content sits on glass panels with a lit edge.
- **Screens reworked.** Today: the stage hero carries the one action; three stat tiles; the plan as a timeline with an icon per block; focus meters; quick-action tiles. Path: a vertical journey with Shu/Ha/Ri kanji, seals on passed stages, no more sideways scrolling on a phone. Character page: a record ring and a two-column board. Log form: tallies grouped (punishing, flash and spin, defence, Heat and oki). Patch Watch: each conflict as a small comparison. Playbook: a grid. Every screen opens with the same header (eyebrow, title, one line on what it is for); navigation has icons; the phone tab bar floats.
- **Fixed on the way:** move names arrived with HTML entities (`Enma&#039;s Flame`, `Wheel of Arrows &gt; Sword Stab`); the `c` suffix tooltip said "recovers crouching" where the spec and speech say "opponent crouching"; tier icons rendered on their own line above each number; Today printed samples like `14.666666666666668`; the onboarding stepper was wider than a phone.

## Design

- `src/styles/tokens.css` holds every colour: four scheme blocks (`[data-theme]`, `[data-theme="dark"][data-scheme]`), scene and glass tokens derived with `color-mix`, and the seigaiha/asanoha/grain patterns as SVG data URIs used as masks (their colour comes from a token). `prefers-reduced-transparency` falls back to solid panels and hides scene art.
- `src/app/theme.ts` adds `SchemeChoice`, `applyScheme`, `readSchemeChoice` (localStorage `zanshin-scheme`, mirrored in `settings.scheme` for backups).
- `src/components/decor/` — `Scene` (fixed, `aria-hidden`, follows "Show art"), `Ornaments` (BrushEnso, BrushStroke, KatanaDivider, Hanko, Embers; original SVG).
- `src/components/media/CharacterArt.tsx` — `CharacterHero` stage (figure `contain`, ambient copy marked `data-ambient`), an ink intro panel when no art exists, `CharacterPortrait` for select tiles; icon frames square.
- `src/components/codex/FrameLegend.tsx` — the key, built from `SUFFIX_TIPS`, `HitLevelChips`, `frameTier`, `DataBadge` and the stance pack, so it cannot drift from what the list renders.
- `src/components/layout/PageHeader.tsx`; `DataBadge` gains `compact` (label only, detail in a tooltip).
- Importer: `mapCargoRow` decodes entities in `Move.name`; the bundled pack was decoded once.

## Independent QA

A separate reviewer agent, which had not seen the work, rendered every route on a phone and a desktop in all four schemes with art in Wavu's shapes, measured crops, overflow and contrast, and ran axe. It found three blockers and a set of misses against the brief; all were fixed before release:

- Blockers: three move names were raw HTML "dotlists" (now "Sword Sweep / Samurai Cutter", in the importer and the pack); the stance map's labels rendered at ~57 px because they were sized in pixels inside a stretched SVG (now viewBox units with a halo); the Combos and Stances lists lost their row layout when the move list got its grid (restored).
- The phone hero still trimmed ~10 % of the figure and a floor gradient faded the feet: on phones the figure now has its own band above the text, and the floor glow sits behind the feet. Text no longer sits on figures (nameplates below portraits). Long phone values wrapped instead of being cut. Phone titles fit (the data badge shrinks to its icon). Engine words are now plain ("sidestep-left" → "Sidestep left", "mastery 0.00, never practiced" → "new, not practised yet", gate ids → "80% of nodes solid"). The key gained input notation, move badges, a fair account of bracketed values and a distinct capital-letter hit level; it opens by default only on wide screens. Fewer boxes: Path lessons are rows, Today's stats are one strip, quick actions are pills, phone move rows have no boxed cells, the key has no boxes inside boxes. Eyebrows over art and the active phone tab now pass AA in every scheme. Each scheme has its own pattern (seigaiha, asanoha, lattice). Page headers on every screen; accent checkboxes; markdown bullets restored.

## Tests

- Unit: every scheme's text and signal colours ≥ 4.5 : 1 on every surface and the two dark overrides define the same tokens (`tests/unit/design/contrast.spec.ts`); scheme persistence, scene character, entity decoding, the key's content (`tests/unit/design/redesign.spec.tsx`). 840 in all.
- End to end (`tests/e2e/design.spec.ts`): no `<img>` is cropped on seven routes with art in Wavu's shapes; the hero figure is `contain`; scene art follows the route; icons are square; the key opens, explains and remembers being closed; names are decoded; each scheme applies from Settings, persists, and passes axe on Today, the move list and Settings; the light theme passes axe including a move page.

## For later

- Stance map, combo and Heat screens kept their structure (they inherit the new surfaces).
- A generated hero background per character colour (from the render's palette) instead of the scheme glow.
