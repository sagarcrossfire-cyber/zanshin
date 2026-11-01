# ZANSHIN 2.0: navigation and imagery research

**Personas:** UX researcher (information architecture, navigation) and art director (visual language, imagery).
**Base:** 1.4.1, the "Ink and steel" redesign. Read in full: `src/app/AppLayout.tsx`, `src/app/AppLayout.css`, `src/styles/tokens.css`, `docs/redesign/DESIGN.md`, `src/app/App.tsx` (routes), `src/components/icons.tsx`, `src/components/decor/*`, `src/styles/fonts.css`, `public/_headers` (CSP), `vite.config.ts` (precache), `index.html`.
**Scope:** research only. The repo was not modified. Nothing was published, downloaded or generated, and no collections or boards were created.

> **Two connectors were unavailable, so I used other sources.**
> - **Mobbin:** all three tools (`search_screens`, `search_flows`, `search_sections`) returned *"Mobbin MCP requires a paid plan."* The fetch of `mobbin.com/explore` was blocked by the permission system. **Section A therefore has no Mobbin URLs.** It cites the primary sources instead: vendor blogs, changelogs and platform docs. A.3 lists the exact Mobbin queries to run once a paid plan exists.
> - **Unsplash connector:** every call returned *"Your email address has not been confirmed."* I found the candidates in D through web search, then read the public unsplash.com pages that search returned. Those pages give the photographer and whether a photo is free or Unsplash+. **I could not view the images themselves** (no downloads). Every pick is judged from its title, alt text and tags, so check each one by eye before adopting it.

---

## 0. What exists today (findings that drive the plan)

| # | Finding | Where |
|---|---|---|
| 0.1 | 23 routes, but the primary nav has only 5 tabs (Today, Lab, Codex, Matches, Path) plus Settings. Coach, Punish, Matchups, Playbook, Progress, Flashcards and Patch Watch are reached only from Today: the quick actions at lines 294–299, the stat tiles at 210–221 and the patch banner at 191. | `AppLayout.tsx:44-50`, `TodayScreen.tsx` |
| 0.2 | **The phone tab bar ignores safe areas.** `index.html` sets `viewport-fit=cover`, but no CSS file uses `env(safe-area-inset-*)`. Installed on an iPhone, the bar sits 12 px from the screen edge, under the home indicator. | `AppLayout.css:43-48`, `index.html:8` |
| 0.3 | Lab Mode's Exit button borrows `.z-tabbar__link` and is re-positioned with `.z-lab .z-tabbar__link`. This is fragile: any restyle of the dock breaks the Exit button. | `AppLayout.tsx:206`, `AppLayout.css:88` |
| 0.4 | **Kanji fall back to system fonts.** The scene watermark 残心 and the Hanko seal 残 are set in `--font-display`, but `fonts.css` imports only the *latin* subsets of Shippori Mincho B1. They render in Hiragino or another fallback, which differs by device. The installed `@fontsource/shippori-mincho-b1` 5.3.0 (OFL-1.1) does ship `japanese-*.css`. | `fonts.css`, `Scene.tsx`, `Ornaments.tsx` |
| 0.5 | The top-bar title asks for weight 700, but only 600 and 800 are loaded. | `AppLayout.css:22`, `fonts.css` |
| 0.6 | `theme-color` is a single static `#0E0F11`, so the PWA status bar ignores the scheme. | `index.html:9` |
| 0.7 | The service-worker precache globs `js,css,html,svg,png,woff,woff2,json` with no `webp` or `avif`. New photo art would not work offline unless it is added on purpose. | `vite.config.ts:132` |
| 0.8 | The CSP is `img-src 'self' blob: data:` and `font-src 'self'`. Hotlinked Unsplash or Adobe Fonts are impossible without loosening it, so all art and fonts must be self-hosted. | `public/_headers` |
| 0.9 | Colour literals are allowed only in `tokens.css` (enforced by `scripts/check-no-colors.mjs`). All new nav colours below are derived tokens built with `color-mix()` from existing tokens. | `scripts/check-no-colors.mjs` |
| 0.10 | Character renders come from the media pack (Wavu Wiki). The production bundle has 41 icons and 33 portraits; 10 roster portraits are missing. Art components render nothing until media exists. Decorative imagery must therefore look complete without renders. | `docs/RELEASE_1.2.0.md`, `AMENDMENT_01B` |
| 0.11 | The media-fit e2e rule allows `object-fit: cover` only when the box matches the image shape within 8 % or the image has `data-ambient`. Photo backdrops should be CSS backgrounds or carry `data-ambient`. | `DESIGN.md` |

---

## A. How strong apps handle navigation

### A.1 Patterns and what to borrow (primary sources; Mobbin unavailable)

| App | Pattern (as sourced) | Source | Borrow for ZANSHIN |
|---|---|---|---|
| **WHOOP**, Oct 2025 home revamp | Moved from swipeable multi-tab pages to one dense, scrollable home. *"The Action button is now more prominent and placed centrally."* Coach *"retains its importance with a new position in the right-hand corner of the bottom menu bar"* and *"is always visible."* | [the5krunner](https://the5krunner.com/2025/10/15/whoop-homescreen-gets-a-revamp), [WHOOP: the all new home screen](https://www.whoop.com/us/en/thelocker/the-all-new-whoop-home-screen/) | Give the AI coach a **permanent tab slot**. Today stays one scrollable page, not swipe tabs. |
| **WHOOP**, nav bar update | A coaching page *"can be immediately accessed from the navigation bar."* The performance profile moved to the avatar at top left. Account, integrations and membership sit behind *"the final icon in the navigation bar on the far right."* | [WHOOP: app update, navigation bar](https://www.whoop.com/us/en/thelocker/app-update-navigation-bar) | Put **Settings and profile inside the last tab's hub**, not as a sixth tab. |
| **Oura**, 2025 redesign | *"Condenses the current five tabs (Home, Readiness, Sleep, Activity, and Resilience) into three new tabs"*: Today, Vitals, My Health. Today reads like a news app's "Top Stories". Oura Advisor (AI) is reached from **My Health**. | [Oura blog](https://ouraring.com/blog/new-oura-app-experience/), [9to5Google](https://9to5google.com/2025/10/20/oura-app-redesign/) | Group by *intent*, not by feature. AI advice can also appear **in context** (the long-term health view), as well as having its own home. |
| **Strava**, layout update | Tabs: Home, Maps, Record, Groups, You. *"Via the You tab, you can track your training, search your workouts and view your profile."* You holds Progress and Activities. | [BikeRadar](https://bikeradar.com/news/strava-beta-test-layout), [Triathlete](https://www.triathlete.com/gear/tech-wearables/strava-overhauls-app-layout-with-new-groups-you-and-maps-sections/) | A **"You" hub** combining progress, the activity log (Matches) and profile. Record stays one tap away via the global log action. |
| **Duolingo**, core tabs redesign | The tab bar holds lessons (home path), quests, leaderboard, video call, profile and social feed. *"Without serving a purpose, tabs can lose their uniqueness and intentionality."* *"Good design means knowing what to remove and what to keep."* One system of header sizes and type styles across tabs. | [Duolingo blog](https://blog.duolingo.com/core-tabs-redesign) | A **shared header system for hubs**: each hub keeps its own identity (banner and kanji) inside one type and spacing grid. |
| **Chess.com** v4 | A bottom bar *"always at the bottom of the screen"* makes *"Play, Puzzles, and Lessons [reachable] with just a couple of taps."* | [Chess.com v4](https://www.chess.com/news/view/chesscom-v4-ios-android) | Training apps put **practice modes** (Puzzles ≈ Punish and Flashcards) on one or two taps. |
| **Linear**, personalised sidebar | *"Hide items you don't use often, and decide how unread notifications should be shown: with a count or dot."* Drag to reorder. Rarely used items go *"behind a More menu."* | [Linear changelog, 2024-12-18](https://linear.app/changelog/2024-12-18-personalized-sidebar) | **Count badges vs dot badges** (count for due cards, dot for "something new"). A **sectioned desktop sidebar** with a quiet overflow. |
| **iOS 26** (Liquid Glass) | The tab bar floats over content and *"will automatically minimize itself when the content … gets scrolled."* A search-role tab *"is separated from your other tabs"* at bottom right. `tabViewBottomAccessory` puts a view above the bar for app-wide content such as media controls. | [Donny Wals](https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/), [WWDC25 session 284](https://developer.apple.com/videos/play/wwdc2025/284/) | A **floating glass dock**. A **"session in progress" accessory** above the dock. Search/palette as a separate affordance, not a tab. |
| **Material 3 Expressive** | The old nav bar is deprecated for a shorter *flexible* bar (horizontal items on medium widths). Navigation drawers are deprecated in favour of a **rail that expands** to show secondary destinations. | [9to5Google](https://9to5google.com/2025/05/14/material-3-expressive-navigation/) | Tablets get a **collapsed rail**; desktops get an **expanded rail that shows the children** of each hub. No hamburger drawer. |
| **Discord**, mobile redesign retrospective | Rolled back a horizontal server dock because it *"made fewer servers visible at once."* Message previews and emoji *"made the tab feel more cluttered and harder to scan."* *"Rather than retrofitting designs meant for mice and keyboards"*, design for touch. | [Discord blog](https://discord.com/blog/improving-our-mobile-experience) | Scannability beats ornament **in the nav itself**: decoration goes in the hub banners, not on the tab labels. The phone gets a phone pattern (dock + sub-nav chips), not a shrunken desktop sidebar. |
| **Raycast**, fallback commands | *"When your search term doesn't have any matching result, you see a list of pre-defined commands."* Users can reorder them with keyboard shortcuts. | [Raycast manual](https://manual.raycast.com/fallback-commands) | The palette never dead-ends: **"Ask the coach about '<query>'"**, "Search moves for '<query>'", "Look it up on the web". |

**Not checked this session** (common knowledge, verify before quoting): Notion's and Arc's collapsible sidebars with a command bar; Nike Training Club, Apple Fitness, Ladder, Speak, Headspace and Lichess using 4–5 tab bars with a profile or "You" tab; console apps (PlayStation, Xbox, Steam) using top-level Store/Library/Social plus a profile hub.

### A.2 What the benchmarks agree on

1. **4–5 tabs, each a different intent.** Oura cut from 5 to 3. WHOOP and Strava keep about 5. Nobody ships 6+ labelled tabs on a phone.
2. **Grouping beats a "More" drawer.** WHOOP keeps an overflow icon only for account and admin items. Linear's "More" holds *rarely used* items only.
3. **The AI or coach has a permanent slot.** WHOOP has Coach in the bar and "always visible". Oura puts Advisor in My Health.
4. **The profile hub absorbs progress, history and settings** (Strava "You", WHOOP's avatar and menu).
5. **Floating glass, minimal chrome** (iOS 26, M3 Expressive), with an accessory slot for live state.
6. **Desktop gets a sectioned, collapsible sidebar plus a palette** (Linear, M3 rail, Raycast).

### A.3 Mobbin queries to run later (on a paid plan, `output_destination: "doc"`)

`search_screens` (ios): "fitness app tab bar with center action button", "WHOOP coach screen", "Strava You tab", "Duolingo home tab bar", "Oura Today tab", "Nike Training Club tab bar", "Chess.com more menu", "Headspace tab bar", "AI coach chat entry point fitness app", "profile screen with rank badge game app".
`search_screens` (web): "Linear sidebar", "command palette", "collapsible sidebar with sections", "Raycast command bar", "Discord server sidebar".
`search_flows` (ios): "switching tabs in a fitness app", "opening a more menu sheet".
Then add each screen's `mobbin_url` to the table in A.1.

---

## B. Recommended 2.0 information architecture

### B.1 Option A (recommended): five intent hubs, Coach in the centre

**Tabs (phone dock, tablet rail and desktop rail all use this order):**

| # | Hub | Kanji mark | Holds (existing routes, no URL changes) | Hub landing |
|---|---|---|---|---|
| 1 | **Today** | 今 | `/today` | Today, unchanged (the stage hero, the next drill, due items) |
| 2 | **Train** | 稽古 | **Lab** `/lab`, `/lab/session/:id` · **Punish** `/punish` · **Flashcards** `/cards`, `/cards/review` · *Baseline* `/baseline` (from the palette and the You hub) | Last-visited child, Lab by default |
| 3 | **Coach** (centre, signature) | 師 | `/coach` with its internal tabs: Ask · Weekly review · Debriefs · Look it up. Recommended: promote these to `/coach/ask`, `/coach/review`, `/coach/debriefs`, `/coach/research` so they deep-link and appear in the palette. | Ask, with the last weekly review pinned above it |
| 4 | **Study** | 書 | **Codex** `/codex/moves`, `/stances`, `/combos`, `/heat` (plus details) · **Matchups** `/matchups`, `/matchups/:c` · **Playbook** `/playbook` · **Patch Watch** `/patch` | Last-visited child, Codex moves by default |
| 5 | **You** (label alternative: "Record") | 道 | **Path** `/path`, `/path/:node` · **Matches** `/log`, `/log/new`, `/log/import`, `/log/:id`, `/log/:id/edit` · **Progress** `/progress` · **Settings** `/settings`, `/settings/media`, `/diagnostics` | A profile header (rank badge from the media pack's `rank-badge` kind, current Path stage, streak, a gear icon for Settings), then the Path · Matches · Progress chips |

The Onboarding route and `/dev/gallery` keep the nav hidden. The gallery is reachable only from the palette.

**Why this grouping:** it follows Sagar's loop: *plan (Today) → practise (Train) → reflect (Coach) → learn (Study) → measure (You)*. Each hub is one intent, which is the Oura and Duolingo principle. Coach sits in the middle of that loop both literally and in the IA, and gets the visual signature (C.3). Settings joins the profile hub, as in Strava and WHOOP.

**Mechanics:**
- **Hub mapping** is one pure function, `hubFor(pathname)`. It drives the dock highlight, the rail highlight, the sub-nav, the top-bar eyebrow and the Scene backdrop choice. Unit-test it against all 23 routes: each route maps to exactly one hub or to `null`.
- **Per-hub memory:** tapping a hub returns to that hub's last child, like iOS tab stacks. Tapping the *active* hub again goes to the hub root and scrolls to the top. Store this in `sessionStorage`, wrapped in try/catch; it is a convenience only.
- **Sub-navigation:** on phone and tablet, a sticky chip row under the top bar lists the hub's children (C.4). On desktop the expanded rail lists them, so the chips hide.
- **The global "Log a match set" action**, needed because Matches drops from a tab to a child of You: from the palette (`L`), the Today quick action, the post-session CTA (already exists), and a "+" on the Matches chip row.
- **Contextual coach entry points**, after Oura's in-context Advisor and WHOOP's always-visible Coach: "Ask the coach about this" on move detail, the character page, log detail and session debrief. Each opens `/coach/ask` with the context attached.
- **Badges** (Linear's count vs dot): Train shows the **count** of due cards. Coach shows a **dot** when a weekly review or debrief is new. Study shows a dot when Patch Watch has unreviewed changes. You shows a dot when a stage gate is ready. Each badge adds visually hidden text to the accessible name, e.g. "Train, 12 cards due".
- **Today quick actions** shrink to the contextual three (Log a match set, Free practice, Ask the coach), because the nav now reaches everything else.

**Phone (< 600 px):** a floating glass dock with the 5 hubs. Above it, an optional **session accessory** pill when an unfinished session exists: "Session · block 2 of 4 · Resume", following iOS 26's bottom accessory. The top bar holds the hub eyebrow and screen title, a **search button** (opens the palette as a full-height sheet) and the data badge, shrunk to its icon.
**Tablet (600–1023 px):** a collapsed rail, 80 px wide, with icons above labels (M3 style), the 5 hubs, then Search and Settings at the bottom. Content keeps the chip sub-nav.
**Desktop (≥ 1024 px):** an expanded rail 248 px wide, shown as a tree (C.5), that collapses to 72 px with `[` or a footer button, remembered per viewer. A "Search or jump to… Ctrl K" trigger sits at the top of the rail.

### B.2 Command palette and quick switch

- **Open:** `Ctrl/Cmd + K` anywhere, or `/` when focus is not in a text field. On phone, the top-bar search button.
- **Before typing, it shows:** *Continue* (Resume session, if any) · *Recent* (the last 5 routes) · *Actions* · *Go to* (all destinations, each labelled with its hub, e.g. "Study › Matchups").
- **Actions:** Start today's session · Free practice · Log a match set · Import matches · Review N due cards · Take the Stage N gate (when ready) · Ask the coach… · Weekly review · Look it up… · Retake baseline · Export a backup · Switch scheme (Manji Night / Crimson Dojo / Heat Surge / Washi Daylight) · Theme (System / Dark / Light) · Show or hide art · Images and clips · Diagnostics.
- **Content search** (lazy-loaded index built from IndexedDB on first open, so the 200 kB gz shell budget holds): moves by **name and input notation** (normalise `1+2`, `b1+2`, `ff3`, `FC df1`), stances by abbreviation (`FLE`, `KIN`, `BT`, `DGF`, `MED`, `IND`, `NSS`, `1SS`, `BDS`), combos, characters (opens Matchups › character), Path nodes, Playbook entries, and log entries by opponent and date.
- **Fallbacks** (Raycast): with no match, offer "Ask the coach about '<q>'", "Search moves for '<q>'" and "Look it up on the web: '<q>'".
- **Keys:** `↑ ↓` move, `↵` open, `Tab` next group, `Esc` close. Quick switch: `Alt+1…5` jumps to a hub (avoids `Ctrl+1…9` browser-tab conflicts). Go-to chords `G` then `T`/`R`/`C`/`S`/`Y` (Today, tRain, Coach, Study, You). `L` logs a match. `[` toggles the rail. All of these are disabled while a text field has focus and **in Lab Mode**.
- **A11y:** `role="dialog"` with `aria-modal`. The input is a `combobox` controlling a `listbox` of `option`s grouped with `role="group"`. Reuse `useFocusTrap` from `Sheet.tsx`; focus returns to the opener.

### B.3 Keeping Lab Mode distraction-free

- With Lab Mode **on**, render none of these: top bar, dock, rail, sub-nav, accessory, palette or shortcuts (only the session's own Space, 0–9 and U keys). The Scene stays "quiet", as it already is: no character and no embers.
- Replace the borrowed `.z-tabbar__link` with a dedicated **session strip** `.z-labstrip`: fixed at the top, 48 px plus `env(safe-area-inset-top)`, glass. Left: block name. Centre: timer in IBM Plex Mono 600, 20/28, tabular. Right: **Exit** pill, 40 px. Exit is **press-and-hold for 600 ms** (`--dur-enso`), with an ensō ring filling around the button. With reduced motion it becomes tap then confirm. `Esc` opens "Exit Lab Mode?".
- With a session **running and Lab Mode off**: normal nav plus the session accessory pill. The update toast stays held, as it is today.

### B.4 Option B (alternative): dock plus a hub sheet

**Tabs:** Today · Lab · **Coach** (centre) · Codex · **More**. More opens a sheet grouped Train / Study / You / App, listing every destination with badges. Desktop is the same rail tree as Option A.

| | Option A, five intent hubs | Option B, dock + More sheet |
|---|---|---|
| One-tap reach | Hubs one tap; children 1–2 taps (memory makes the usual child one tap) | Lab, Codex and Coach one tap; everything else 2 taps |
| Change from 1.4 | Medium: Matches and Path move under You | Small: Matches and Path move into More, Coach replaces them |
| Discoverability | High: every destination visible as chips inside its hub | Lower: Punish, Cards, Matchups, Playbook and Patch hide behind More (Linear's own guidance keeps More for *rarely used* items, and these are not rare) |
| Scales to 2.x features | Yes: new screens join a hub | More becomes a junk drawer |
| Desktop | Identical rail tree | Identical rail tree |
| Risk | Users must learn "You" contains Matches | Hidden trainers get used less |

**Recommendation: Option A.** Option C, Oura-style three tabs, was rejected: Train and Study are both heavily used and would be buried.

---

## C. Visual uplift for the nav ("lacquer dock, ink scroll")

**Concept:** the phone dock is an **obi**, a band of lacquered glass with a lit seam along its top edge. The desktop rail is a **makimono**, a hanging scroll with ink section marks and a faint ensō at its foot. Ornament stays in the material and the seams. Labels and icons stay plain and scannable, per the Discord lesson.

### C.1 New derived tokens (append to the derived block in `tokens.css`; only existing tokens are referenced)

```css
/* Nav (2.0): fallbacks first, like the existing derived block. */
:root, [data-theme], [data-scheme] {
  --nav-surface: var(--raised);
  --nav-border: var(--line-strong);
  --nav-edge: var(--line-strong);          /* lit top edge (inset highlight) */
  --nav-hover: var(--overlay);
  --nav-active-fill: var(--overlay);
  --nav-active-ring: var(--accent);
  --nav-glow: transparent;
  --nav-dot: var(--accent-2);              /* "new" dot; not a signal colour */
  --nav-count-bg: var(--accent);  --nav-count-fg: var(--on-accent);
  --nav-blur: 20px;
}
@supports (color: color-mix(in srgb, black 50%, transparent)) {
  :root, [data-theme], [data-scheme] {
    --nav-surface: color-mix(in srgb, var(--raised) 74%, transparent);
    --nav-border: color-mix(in srgb, var(--line-strong) 55%, transparent);
    --nav-edge: color-mix(in srgb, var(--text-1) 14%, transparent);
    --nav-hover: color-mix(in srgb, var(--text-1) 6%, transparent);
    --nav-active-fill: color-mix(in srgb, var(--accent) 18%, transparent);
    --nav-active-ring: color-mix(in srgb, var(--accent) 45%, transparent);
    --nav-glow: color-mix(in srgb, var(--accent) 32%, transparent);
  }
  /* Washi: paper does not glow; a lighter wash and a white paper edge. Must follow the block above. */
  [data-theme="light"] {
    --nav-surface: color-mix(in srgb, var(--raised) 84%, transparent);
    --nav-edge: color-mix(in srgb, var(--raised) 90%, transparent);
    --nav-active-fill: color-mix(in srgb, var(--accent) 11%, transparent);
    --nav-glow: transparent;
  }
}
@media (prefers-reduced-transparency: reduce) {
  :root, [data-theme], [data-scheme] { --nav-surface: var(--raised); --nav-blur: 0px; }
}
```

All four schemes inherit this automatically: Manji glows cyan, Crimson vermilion, Heat violet, and Washi uses a seal-red wash with no glow. Contrast: inactive labels use `--text-2` and active labels `--text-1` (both AA on `--raised`). The active icon uses `--accent` (≥ 3:1 against `--nav-active-fill`). Recheck with the existing axe pass in every scheme.

### C.2 Phone dock `.z-dock` (replaces `.z-tabbar`)

| Property | Value |
|---|---|
| Position | `fixed`. `left: max(var(--space-3), env(safe-area-inset-left))`, the mirror for `right`. `bottom: max(var(--space-3), calc(env(safe-area-inset-bottom) - var(--space-1)))`, which is about 30 px on an iPhone with a home indicator and 12 px elsewhere (fixes 0.2). `margin-inline: auto; max-width: 440px`. |
| Size | Height **64 px**, `padding: var(--space-1)`, grid `repeat(5, 1fr)`. Items are **56 px** tall: 64 px total minus 2 × 4 px padding (touch target ≥ 44 × 44). |
| Material | `background: var(--nav-surface)`. `backdrop-filter: blur(var(--nav-blur)) saturate(1.4)`, with the `-webkit-` prefix. `border: 1px solid var(--nav-border)`. `border-radius: var(--radius-pill)` (a capsule). `box-shadow: inset 0 1px 0 var(--nav-edge), var(--shadow-overlay)`. |
| Lit seam | `::after`: 1 px tall, inset `left/right: 20%`, `top: -1px`. `linear-gradient(90deg, transparent, var(--accent-line), var(--accent-2), transparent)` at `opacity: .5`. It repeats the top bar's seam, so the chrome reads as one set. |
| Lacquer grain | `::before`: `background-image: var(--pattern-grain)`, `opacity: .04`, `mix-blend-mode: overlay`, clipped to the capsule. |
| Item | Column flex, `gap: 2px`. Icon **24 px**. Label IBM Plex Sans **11/14, 500**, `letter-spacing: .02em`, colour `--text-2`. Active: label `--text-1` weight 600, icon `--accent` plus the icon's fill layer (C.6). |
| Active indicator | **One** absolutely positioned capsule `.z-dock__indicator`: `top/bottom: var(--space-1)`, width one column minus 8 px, `background: var(--nav-active-fill)`, `box-shadow: inset 0 0 0 1px var(--nav-active-ring), 0 8px 20px -10px var(--nav-glow)`. It moves with `transform: translateX(calc(var(--i) * 100%))`, `transition: transform var(--dur-sheet) var(--ease-enter)`. |
| Coach (centre) signature | The icon sits inside a **36 px brush ensō ring** (a small `BrushEnso`, `stroke: var(--accent-2)` at 70 % when inactive, `var(--accent)` when active). When Coach becomes active the ring draws in (stroke-dashoffset, `--dur-enso` 600 ms). The item stays 56 px tall: **no raised FAB**, because the centre is a destination, not a create button. |
| Badges | **Count:** min-width 18 px, height 18 px, `--radius-pill`, IBM Plex Mono 600 11/18 (tabular), `--nav-count-bg` with `--nav-count-fg`, at `top: 6px; left: calc(50% + 6px)`, with `box-shadow: 0 0 0 2px var(--raised)` to cut it out from the icon. **Dot:** 8 px, `--nav-dot`, the same cut-out ring. |
| Press | `transform: scale(.94)` for `--dur-press` (120 ms). |
| Content clearance | `.z-main` gets `padding-bottom: calc(64px + max(var(--space-3), env(safe-area-inset-bottom)) + var(--space-6))`, plus 48 px when the session accessory shows. |
| Optional (phase 2) | iOS-26-style **minimise on scroll-down**: the dock shrinks to a 48 px capsule showing the active icon plus the search button, `--dur-standard`. Off under reduced motion. Long-press a hub to open a quick sheet of its children. |

**Session accessory `.z-dock-accessory`:** a 40 px capsule, the same material, 8 px above the dock, matching its width. Content: an `IconClock`, "Session · block 2 of 4", a mono timer, and "Resume ›". `role="status"` is not needed because it is a link.

### C.3 Top bar `.z-topbar`

- Height **56 px** (was 60) plus `padding-top: env(safe-area-inset-top)`, and `padding-inline: max(var(--space-4), env(safe-area-inset-left/right))`.
- Phone: the logo mark at 28 px · a **two-line title block**: an eyebrow (the hub name, 11/16, 600, 0.14 em, uppercase, `--accent`, e.g. "STUDY") over the screen title (Shippori Mincho B1 **800**, 20/28; fixes 0.5) · a search `IconButton` 40 px · the data badge, icon only.
- Desktop: the brand moves into the rail header; the top bar keeps the eyebrow and title, an offline chip and the data badge.
- Keep the existing gradient seam (`::after`). Make `theme-color` follow the scheme: set `<meta name="theme-color">` from `theme.ts` to the scheme's `--scene-top` (fixes 0.6).

### C.4 Sub-nav chips `.z-subnav` (phone, tablet, and desktop with the rail collapsed)

- `position: sticky; top: calc(56px + env(safe-area-inset-top))`. Height **48 px**, `padding-inline: var(--space-4)`. Horizontal scroll with `scroll-snap-type: x proximity` and the scrollbar hidden. Edge fade: `mask-image: linear-gradient(90deg, transparent, black 16px, black calc(100% - 16px), transparent)`.
- Chip: height **36 px**, `padding: 0 var(--space-4)`, `--radius-pill`, IBM Plex Sans 14/20 500, `--text-2`. **Active:** `--nav-active-fill`, `inset 0 0 0 1px var(--nav-active-ring)`, `--text-1` weight 600. Hover: `--nav-hover`. Badges as in the dock, inline after the label.
- `nav aria-label="Train sections"` (one per hub), with `aria-current="page"` on the active chip.
- The Codex keeps its own Moves · Stances · Combos · Heat tabs below this row, as a second, smaller row (32 px chips) or the existing `Tabs` component.

### C.5 Desktop rail `.z-rail` (≥ 1024 px; collapsed variant on tablet)

```
┌──────────────────────────────┐  248 px expanded / 72 px collapsed
│ ◉ ZANSHIN                    │  header 56 px (mark 28 px + wordmark 15 px, 800, 0.18em)
│ ⌕ Search or jump to…  Ctrl K │  40 px trigger, --radius-control, 1px --nav-border
│                              │
│ 今 Today                     │  hub row 40 px
│ 稽古 Train                    │  hub row (ancestor state when a child is active)
│    Lab                       │  child rows 36 px, indented 36 px (aligned under the label)
│    Punish Trainer            │
│    Flashcards           12   │
│ 師 Coach                   • │
│ 書 Study                     │
│    Codex · Matchups · Playbook · Patch Watch •
│ 道 You                       │
│    Path · Matches · Progress │
│ ─────────────────────────── │
│ ⚙ Settings          [ ⟨ ]   │  footer: settings + collapse toggle
│        (faint ensō 160px)    │  ornament, opacity .05
└──────────────────────────────┘
```

| Property | Value |
|---|---|
| Frame | `position: sticky; top: 0; height: 100dvh`. Width **248 px** (62 × 4) expanded, **72 px** collapsed (tablet: **80 px** with labels under icons). `padding: var(--space-3)`. `background: var(--glass)`, `backdrop-filter: blur(16px) saturate(1.3)`, `border-right: 1px solid var(--glass-border)`. |
| Hub row | 40 px, `gap: var(--space-3)`, `padding: 0 var(--space-3)`, `--radius-control`. Icon 20 px. IBM Plex Sans 15/20 500, `--text-2`. A **kanji mark** (Shippori Mincho B1 800, 13 px, `--text-3`, `aria-hidden`) can replace the icon when the rail is expanded, as a Settings choice "Rail marks: icons / kanji". The default is icons. |
| Child row | 36 px, IBM Plex Sans 14/20 400, `--text-2`, a 36 px left indent so labels align. The count badge is right-aligned (mono). |
| Active (exact) | `background: var(--nav-active-fill)`, label `--text-1` 600, icon `--accent`. A **blade** `::before`: 3 × 20 px, `left: -12px` (on the rail edge), `linear-gradient(180deg, var(--accent), var(--accent-2))`, `box-shadow: 0 0 12px var(--nav-glow)`, which is the existing indicator with a glow added. |
| Ancestor (hub of the active child) | No fill. Label `--text-1`, icon `--accent`. |
| Hover / focus | `--nav-hover` on hover. `:focus-visible` gets `outline: 2px solid var(--info); outline-offset: 2px` (`--info` is the focus-ring token). |
| Collapsed | Rows become 48 × 48 icon buttons. A **tooltip** to the right (glass, 32 px, 13/18) after a 300 ms hover, or on focus. Children are reachable through the hub's last-child memory and the sub-nav chips, which show again in content when collapsed. |
| Collapse | The `[` key or the footer button (`aria-expanded`, `aria-controls`). `transition: width var(--dur-standard) var(--ease-enter)`; labels fade with `opacity` over `--dur-press`. Remembered in `localStorage` (try/catch). |
| Ornament | The rail foot shows `BrushEnso` at 160 px, `opacity: .05`, `color: var(--pattern-ink)`, plus a seigaiha band masked to fade upward (the existing pattern-mask technique, `--scene-pattern`), which gives each scheme its own pattern for free. |

### C.6 Icons (house style: 24 grid, 1.75 stroke, round joins, `currentColor`)

- **Keep:** IconToday, IconCoach, IconLab, IconPunish, IconCards, IconCodex, IconMatchups, IconLog, IconPath, IconProgress, IconPatch, IconSettings, IconSearch.
- **New hub icons** (drafts, refine on the grid):
  - `IconTrain`, a makiwara striking post: `<path d="M12 3v18"/><rect x="8.5" y="5.5" width="7" height="8" rx="1.5"/><path d="M8 21h8"/>`
  - `IconStudy`, a scroll: `<path d="M6.5 4.5H17a2 2 0 0 1 0 4H8.5"/><path d="M6.5 4.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H17"/><path d="M8.5 8.5v11"/><path d="M11.5 12h5M11.5 15h3.5"/>`
  - `IconYou`, a peak with a flag (the summit of the path, matching the mountain imagery): `<path d="M3 19.5 9.5 9l4 6 2.5-3.5 5 8z"/><path d="M15 7.5V3.5l3.5 1.4L15 6.2"/>`
  - Also: `IconSidebar` (collapse), `IconKeyboard` (shortcut hints), `IconPlus` (log).
- **Active "fill" layer:** add an optional `active` prop to `Svg`, or a `.z-ni__fill` group, for nav icons only. Each nav icon carries one filled silhouette of its main shape with `fill: currentColor; fill-opacity: 0`, which goes to `.2` when active over `--dur-standard`. This follows the outline-to-filled convention without a second icon set. Stroke width is unchanged.
- No game logos, no manji, no Yoshimitsu emblem. Hub kanji are text (with a subset font, E.2), not images.

### C.7 Palette visuals `.z-palette`

- Desktop: a centred `Modal`, `top: 15vh`, `width: min(640px, 100vw - 32px)`, `max-height: 60vh`, `--radius-sheet`, `--nav-surface` with blur, `--shadow-overlay`, and the lit seam. Phone: the existing `Sheet` at full height with the input pinned to the top.
- Input: 52 px, IBM Plex Sans 17/26, a leading `IconSearch` 20 px, no border, separated from the results by a 1 px `--line` divider.
- Rows: 44 px, `--radius-control`. Icon 20 px, then label, then hub crumb (13/18, `--text-3`), then a right-aligned shortcut shown as `kbd` chips (IBM Plex Mono 12/20, height 20 px, `padding: 0 6px`, `--radius-chip`, `1px solid var(--line-strong)`). Selected row: `--nav-active-fill` plus the 3 px blade. Group headings use the eyebrow style.
- Footer (desktop only): `↑↓ navigate · ↵ open · esc close` in `--text-3`, 12/16.

### C.8 Motion and accessibility

| Element | Motion | `prefers-reduced-motion: reduce` |
|---|---|---|
| Dock indicator | translateX, `--dur-sheet`, `--ease-enter` | jumps (no transition) |
| Coach ensō | draws in, `--dur-enso` | appears drawn |
| Icon fill | opacity, `--dur-standard` | instant |
| Press | scale .94, `--dur-press` | none |
| Rail collapse | width and opacity, `--dur-standard` | instant |
| Palette | fade + scale .98→1, `--dur-standard`; phone sheet slides, `--dur-sheet` (existing) | fade only, or none |
| Hub switch | optional View Transitions crossfade, 150 ms, behind `document.startViewTransition` feature detection | off |
| Lab Exit hold | ensō ring fills over 600 ms | tap, then confirm |

Also: `prefers-reduced-transparency` makes every nav surface solid with no blur (the token handles it). Keep focusing the screen title on route change. Add `aria-current="page"` to the active dock and rail items (`NavLink` already does this for exact matches; hub items need it set by hand, from `hubFor`).

**Tests to add:** `hubFor` covers all routes; the dock does not overlap content, checked by e2e with emulated safe-area insets; Ctrl+K and `/` open the palette and Enter navigates; Lab Mode renders no `nav` landmarks; axe on every route in every scheme (the existing pass, extended); a reduced-motion snapshot; the palette chunk is lazy (`check-bundle.mjs`).

---

## D. Imagery plan ("way more imagery")

### D.1 Principles

1. **One grayscale photo works in every scheme.** Ship each photo as **grayscale AVIF with a WebP fallback**, and tint it at runtime with tokens. Sagar keeps all four schemes without four copies of each image:
   ```css
   .z-hall { position: relative; isolation: isolate; overflow: hidden; border-radius: var(--radius-card); }
   .z-hall::before { content: ''; position: absolute; inset: 0; z-index: -2;
     background: linear-gradient(135deg, var(--scene-glow-1), var(--scene-bottom) 60%, var(--scene-glow-2)); }
   .z-hall__photo { position: absolute; inset: 0; z-index: -1;
     background: var(--hall-photo) center / cover no-repeat;          /* image-set(avif, webp) set per hub */
     mix-blend-mode: luminosity; opacity: var(--hall-photo-opacity, .55);
     -webkit-mask-image: linear-gradient(180deg, black 0%, black 40%, transparent 95%);
             mask-image: linear-gradient(180deg, black 0%, black 40%, transparent 95%); }
   [data-theme="light"] .z-hall__photo { mix-blend-mode: multiply; opacity: .35; }  /* sumi print on washi */
   ```
   CSS backgrounds are not `<img>`, so the media-fit rule (0.11) does not apply. If an `<img>` is used, mark it `data-ambient`.
2. **Character renders are the stars; photos are the set.** Photos stay low-contrast and masked, and never sit behind body text above about 12 % opacity. Text stays on glass.
3. **Obey the existing switches.** "Show art" off hides all photos. `prefers-reduced-transparency` hides them (`--scene-art-opacity: 0` pattern). The Lab session shows none. Safe Mode may still show them, since they are static site assets.
4. **Budget and offline.** Each hub photo comes at 800 w (phone) and 1600 w (desktop), AVIF about 40–110 KB each. Precache only the 800 w set; serve 1600 w with a runtime CacheFirst route. Add `avif`/`webp` under `art/` to the Workbox globs (fixes 0.7). Add an **art budget** of ≤ 1.5 MB precached to `check-bundle.mjs`. Store under `public/art/<slug>-<w>.{avif,webp}`, with credits in `src/data/art-credits.json`, shown in Settings › Images and clips › Credits.

### D.2 Where imagery goes

| Surface | Image role | Treatment |
|---|---|---|
| Scene layer, every screen | One hub backdrop photo per hub, top 45 % of the viewport, behind the pattern, `opacity .10–.16`, then grain; the character render stays bottom-right | luminosity tint; the pattern and ensō stay on top |
| Hub banners ("halls"), 5 + Heat + Onboarding | Phone 160 px / desktop 220 px stage: photo plus a big kanji watermark (今, 稽古, 師, 書, 道 at 120 px, `opacity .06`), eyebrow and title | `.z-hall` above |
| Path stages | **A journey of landscapes** from foothills to summit: Stage 1 bamboo foothills → misty ridge → shrine approach → peaks in cloud → moon over water (mastery). Stage gates get a hanko seal. | photo + original SVG ridge layers (D.5) |
| Empty states | Lantern (no matches yet), dojo floor (no sessions), washi (no cards), raked gravel (rest day) | photo vignette 3:2 with `--radius-card`, 40 % luminosity |
| Flashcards | Washi texture on the card face (Washi Daylight); a deep lacquer face in dark schemes | tileable texture at `.08` |
| Coach | Moon over water (水月, "the moon in water": the reflective mind of zanshin) | hall banner |
| Heat | Embers and burning coals, tinted `--heat` / `--accent-2` | hall banner + the existing embers |
| Punish Trainer | Steel: a blade close-up (the punish is the cut) | hall banner |
| Onboarding | Torii corridor ("entering the path") | full-bleed, 30 % |

### D.3 Unsplash candidates (30, all marked **free under the Unsplash License**, not Unsplash+, on the pages read)

> I chose these from titles, alt text and tags only; the images themselves were not seen. Check each one by eye: tone, crop room, no legible signage, no identifiable faces.

| # | ID | Photographer | URL | Suits | Why |
|---|---|---|---|---|---|
| 1 | `EsyRI8Wag40` | Adam Wilson (@fourcolourblack) | [link](https://unsplash.com/photos/a-corridor-of-red-torii-gates-in-japan-EsyRI8Wag40) | Onboarding; Path hub | Fushimi Inari corridor, evening; leading lines = progression; red works raw in Crimson Dojo, tinted elsewhere |
| 2 | `UWheXkRpWKI` | Masaaki Komori (@gaspanik) | [link](https://unsplash.com/photos/UWheXkRpWKI) | Today hall (dark schemes) | "Dark torii gate on a rocky outcrop surrounded by the ocean"; lone gate, lots of negative space *(photo page fetch blocked; licence from the search listing)* |
| 3 | `SBK40fdKbAg` | Tianshu Liu (@tianshu) | [link](https://unsplash.com/photos/SBK40fdKbAg) | Today hall (Washi Daylight) | Lake Ashi torii in water; calm morning feel for the light theme |
| 4 | `2gGPUM_z1XA` | Wu Hsien Yu (@heyywh) | [link](https://unsplash.com/photos/2gGPUM_z1XA) | Coach alternative | Torii in the middle of water; reflection theme |
| 5 | `tvJX2DTeCiQ` | Filip Kvasnak (@filipkvasnak) | [link](https://unsplash.com/photos/misty-mountains-shrouded-in-dark-clouds-at-dawn-tvJX2DTeCiQ) | Path hub; You hub | "Moody morning", tags blue, dark forest, foggy; layered ridges read as ink wash once grayscaled (High Tatras, not Japan, so no landmark clash) |
| 6 | `N4VkXy69KI4` | TOMOKO UJI (@ujitomo) | [link](https://unsplash.com/photos/bamboo-forest-canopy-with-green-stalks-N4VkXy69KI4) | Train hub; desktop rail foot (vertical crop) | Arashiyama bamboo canopy; vertical rhythm = discipline |
| 7 | `eouEtrJf844` | Vincent Botta (@0asa) | [link](https://unsplash.com/photos/eouEtrJf844) | Coach › Ask background; loading states | Black ink in clear water; sumi in motion |
| 8 | `zHfhQlQswec` | FÍA YANG (@fiayang) | [link](https://unsplash.com/photos/black-ink-wash-abstract-zHfhQlQswec) | Washi Daylight scene; Patch Watch | Black ink washes bleeding into white paper; literal sumi-on-washi |
| 9 | `uhWEGjTfStg` | Fons Heijnsbroek (@heijnsbroek_abstract_art) | [link](https://unsplash.com/photos/abstract-black-and-white-ink-brush-strokes-uhWEGjTfStg) | Study hub; Playbook | Ink drawing on paper, tags calligraphy and ink wash; high contrast takes a tint well |
| 10 | `3q3O3QftPVo` | Katrin Hauf (@trine) | [link](https://unsplash.com/photos/white-and-black-smoke-illustration-3q3O3QftPVo) | Heat (Heat Surge tint); transitions | Monochrome smoke; turns into violet "Heat haze" |
| 11 | `2nKcZGDHpEs` | 360floralflaves (@360floralflaves) | [link](https://unsplash.com/photos/2nKcZGDHpEs) | Flashcard faces; Washi surfaces | "Light grey paper texture with fine fibrous strands" (kozo-like) |
| 12 | `U2j1u4BWrpM` | Bart Wesolek (@bartco86) | [link](https://unsplash.com/photos/U2j1u4BWrpM) | Patch notice panels; light cards | Flat white paper texture |
| 13 | `FZBoZOmI9hs` | Safwan Thottoli (@safwan_thottoli) | [link](https://unsplash.com/photos/FZBoZOmI9hs) | Washi Daylight scene base (multiply) | Blank beige parchment; warms `--bg` |
| 14 | `6fAgnT3Dhl4` | Svetlana Gumerova (@bananablackcat) | [link](https://unsplash.com/photos/japanese-lantern-light-during-night-time-6fAgnT3Dhl4) | Matches empty state; You hub | A single Japanese lantern at night: "keep the light on" |
| 15 | `D68ADLeMh5Q` | Denys Nevozhai (@dnevozhai) | [link](https://unsplash.com/photos/alleyway-with-red-lanterns-in-tokyo-D68ADLeMh5Q) | Matchups hub (Crimson Dojo) | Red-lantern alley = the street of rivals; blur hard because of signage |
| 16 | `vTjip4rq7hc` | Eddy Boom (@eddyboom) | [link](https://unsplash.com/photos/white-paper-lantern-vTjip4rq7hc) | Coach › Look it up (research notes) | A white paper lantern = illumination and research |
| 17 | `R20NOBAegME` | Kristijan Arsov (@aarsoph) | [link](https://unsplash.com/photos/ornate-wooden-roof-of-a-traditional-japanese-building-with-trees-R20NOBAegME) | Study hub (Codex) | Ginkaku-ji roof detail, Kyoto; temple architecture = a library of knowledge |
| 18 | `YpeAO8fNJkY` | Takashi Miyazaki (@miyatankun) | [link](https://unsplash.com/photos/cherry-blossoms-light-up-a-river-at-night-YpeAO8fNJkY) | Stage gate passed; You hub | Cherry blossoms lit at night along a river; the reward moment |
| 19 | `0XQJbE548ZI` | Takashi Miyazaki (@miyatankun) | [link](https://unsplash.com/photos/cherry-blossoms-line-the-trees-along-a-river-at-night-0XQJbE548ZI) | Alternative to #18 | Same series, different composition |
| 20 | `yhWkR8yF0tk` | Jr Korpa (@jrkorpa) | [link](https://unsplash.com/photos/pink-and-brown-cherry-blossom-tree-during-nighttime-yhWkR8yF0tk) | Heat Surge milestone modal | Night blossom tree; moody colour (Korpa's work is usually abstract and dark) |
| 21 | `Wknl_fbr-YM` | Jeff Pratley (@pratjeffley) | [link](https://unsplash.com/photos/a-full-moon-over-a-body-of-water-at-night-Wknl_fbr-YM) | **Coach hall banner** | Full moon over water at night (水月) |
| 22 | `DyaIOeGcMUA` | Josh Massey (@joshuamphotography) | [link](https://unsplash.com/photos/moon-above-body-of-water-DyaIOeGcMUA) | Coach › Weekly review | Moon above water; alternative crop |
| 23 | `D5A-TwxRpUg` | Takafumi Yamashita (@yamashita0129) | [link](https://unsplash.com/photos/a-large-empty-room-D5A-TwxRpUg) | Lab hub; "no sessions yet" | An empty hall from the "dojo" search; quiet space before practice |
| 24 | `SkYjyctnC5Q` | Simon Dreher (@notphotogenic) | [link](https://unsplash.com/photos/people-practicing-kendo-in-a-dojo-SkYjyctnC5Q) | Train hub alternative | Kendo in a dojo; masks hide faces (check), keeps the energy of practice |
| 25 | `NP8GAo1UpBA` | Seiya Maeda (@seiya_maeda) | [link](https://unsplash.com/photos/a-large-knife-with-a-long-blade-attached-to-it-NP8GAo1UpBA) | **Punish Trainer** hall | Long blade from the "katana" search; steel = the punish |
| 26 | `e7A4f_gJvaI` | True Knife (@trueknife1) | [link](https://unsplash.com/photos/a-damascus-steel-knife-with-a-patterned-handle-e7A4f_gJvaI) | Steel texture strip (Punish ladder header) | Damascus pattern; **crop to steel only** (the maker's brand account; avoid any mark) |
| 27 | `LDi9F6oGojQ` | Pawel Czerwinski (@pawel_czerwinski) | [link](https://unsplash.com/photos/burning-coals-LDi9F6oGojQ) | **Heat** hall | Burning coals = embers; tints to `--accent-2` / `--heat` |
| 28 | `BINLgyrG_fI` | Hannah Gibbs (@hannahmgibbs) | [link](https://unsplash.com/photos/man-pounding-hammer-on-hot-iron-rod-BINLgyrG_fI) | Path "forging" stage; streak milestones | Hammer on hot iron = forging skill; crop out the person |
| 29 | `WGMIlXUyQdc` | Ray Wyman Jr (@heavypen) | [link](https://unsplash.com/photos/a-rock-garden-with-rocks-and-gravel-WGMIlXUyQdc) | Codex › Stances; rest-day state | A karesansui rock garden; raked ripples echo the stance map |
| 30 | `gQljeKrJTwI` | Leon Gao (@leongao) | [link](https://unsplash.com/photos/a-rock-garden-in-the-middle-of-a-graveled-area-gQljeKrJTwI) | Alternative to #29 | A rock garden in a gravel field |

Also noted but **excluded**: Unsplash+ items such as `OLgeT942EyA` (misty mountains, Taiki Ishikawa) and `61akpj5Ht8A` (black ink in water, Andrew Petrischev). Those need a paid licence. An illustration reference, not a pick: `iN_GeqrT_2M`, a black torii silhouette by Anupam Raisim Kerketta (free). The torii shape should be drawn in SVG instead (D.5).

### D.4 Unsplash licence terms that matter

- **[Unsplash License](https://unsplash.com/license):** an *"irrevocable, nonexclusive, worldwide copyright license to download, copy, modify, distribute, perform, and use images … for free, including for commercial purposes, without permission from or attributing the photographer or Unsplash."* The one stated restriction: it *"does not include the right to compile images from Unsplash to replicate a similar or competing service."* Attribution is *"appreciated"*, not required.
- **Unsplash+ is a different, paid licence** ([Unsplash+ License](https://unsplash.com/plus/license)). Excluded above.
- **The [API Guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines) apply only to apps that use the API**, and they matter for how the files are obtained:
  - API apps *"must use the hotlinked image URLs returned by the API"* for *all* uses.
  - When a user does *"something similar to a download"*, the app must call `photo.links.download_location` ([Triggering a download](https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download)). That call is *"purely an event endpoint used to increment the number of downloads."* Do not use `links.download` or embed from it.
  - Displays must credit the photographer and Unsplash with links carrying `?utm_source=<app>&utm_medium=referral` ([Attribution](https://help.unsplash.com/en/articles/2511315-guideline-attribution)).
- **What this means for ZANSHIN:** the app must **not** call the Unsplash API at runtime. The CSP `img-src 'self'` blocks hotlinks, and the app is offline-first. So:
  1. Sagar downloads each chosen original **from unsplash.com** (the site's Download button counts the download). Alternatively, Claude does it once the connector works, through `download_asset`, which hits `download_location`. **Either route is a deliberate, approved step.**
  2. Process the files to grayscale AVIF/WebP at build time and self-host them under the Unsplash License.
  3. Credit anyway in Settings › Credits: "Photo by <name> on Unsplash", linked. UTM is only required for API apps, but harmless.
  4. Keep the set small and curated. A few dozen backdrops is nowhere near "replicating a similar service".
- **People and marks:** Unsplash provides no model or property releases, and has a [help article on brands and logos in images](https://help.unsplash.com/en/articles/14224409-what-if-there-is-a-brand-logo-in-an-image-on-unsplash). So: no identifiable faces (#24 and #28 need crops), and crop out signage or maker marks (#15, #26).

### D.5 Draw these as original SVG in code (token-coloured, `aria-hidden`, a few hundred bytes each)

Already have: ensō, brush stroke, katana divider, hanko, embers, and the seigaiha, asanoha, lattice and grain patterns. **Add:**
1. **Ink-wash ridge layers:** 3–4 mountain silhouettes generated from a seeded path. Gradient fills from `--scene-glow-1` to `--scene-bottom`, plus an SVG `feTurbulence`/`feDisplacementMap` "ink bleed" filter. Used for Path stage headers, the You hub and empty states, and as the no-photo fallback for every hall (so halls look finished with art off).
2. **Torii silhouette:** generic architecture. Two pillars, kasagi and nuki. For Today and Onboarding, and the Path gate badges.
3. **Moon and ripples:** a disc plus 3 concentric broken arcs. The Coach hall fallback, and an empty Ask state.
4. **Bamboo stalks:** segmented vertical strokes with node rings. The Train hall fallback and the desktop rail foot.
5. **Hub crests:** five original geometric marks (circle plus brush strokes), each distinct. **Not the manji, not Yoshimitsu's crest, not any Tekken emblem.**
6. **Rank and stage seals:** hanko variants with stage numerals (一 to 十), for Path and the You header.
7. **Shoji / kumiko frame:** a thin asanoha border for featured cards (a stroke on a pattern mask).
8. **Kanji watermarks** (今 稽古 師 書 道 残心) as **text in a subset font** (E.2), not paths, so they stay crisp and accessible to hide.

### D.6 Wavu Wiki renders (the media pack, already bundled in production)

- **Keep:** the Scene edge render; the stage hero (Today, character page); the Matchups 3:4 portrait grid.
- **Add:**
  - The opponent's **icon chip** beside each punishable move in the Punish Trainer.
  - Opponent icons in Coach answers that name a character.
  - A **rank badge** (`rank-badge` kind) in the You hub header and the desktop rail header.
  - `app:key-art` on the Onboarding splash when present.
- **Fallbacks:** for the 10 roster portraits not on Wavu, use a **generic ink silhouette** (an abstract standing figure that resembles no character) plus the existing initials tile. Never generate a character likeness.

### D.7 Generated later, only if Sagar approves spending credits (Firefly, ElevenLabs image or Gamma; **nothing was generated**)

Ask for **monochrome output** so the D.1 tinting works. Banners: 2400 × 1000 px and 1080 × 1350 px. Textures: 1024 × 1024 px, seamless. **Negative prompt for all:** *people, faces, characters, masks, armour, swords held by figures, logos, text, watermarks, manji, swastika, video-game UI, Tekken*.

1. **Path ridges:** "Sumi-e ink wash painting of layered mountain ridges dissolving into mist, monochrome black ink, vast empty sky in the upper half, visible paper grain, calm, minimal."
2. **Shrine approach (Today, Onboarding):** "Night approach to a mountain shrine, row of stone lanterns softly glowing, mist between cedar trees, deep blue-black, cinematic, empty path, monochrome."
3. **Steel (Punish):** "Macro of folded steel blade surface with a wavy temper line, cold rim light, black background, fills the frame, no handle, monochrome."
4. **Coach moon:** "Full moon reflected on perfectly still black water, a few reeds in silhouette, ink wash style, enormous negative space, monochrome."
5. **Train bamboo:** "Bamboo grove at night painted in bold vertical ink strokes, moonlight from the left, monochrome."
6. **Heat haze:** "Abstract energy smoke tendrils rising on a midnight background, soft glow, no figures, monochrome."
7. **Washi texture:** "Seamless tileable washi paper texture with visible kozo fibres, evenly lit, neutral off-white, no folds."
8. **Dojo floor (Lab, empty states):** "Empty dojo interior, polished wooden floorboards and paper shoji screens, dawn light, wide, no people, monochrome."

Rules: no "in the style of <living artist>", no recreation of a copyrighted character or emblem, and log the prompt, model and date next to each file's credit.

---

## E. Type (Adobe tools skipped)

### E.1 Why Adobe was skipped

The fonts must be self-hosted (`font-src 'self'`) under an open licence. Adobe Fonts are licensed for use through Adobe's hosted kits, not for self-hosting, so `font_recommend` and `suggest_type_palettes` results could not ship. I did not call `adobe_mandatory_init` or any Adobe tool.

### E.2 Recommendations (all OFL, through `@fontsource`, self-hosted)

- **Keep the trio** for nav labels and data: Shippori Mincho B1 (display), IBM Plex Sans (UI and labels), IBM Plex Mono (badges, timers, `kbd` chips).
- **Fix the kanji (0.4) without bloating the precache.** Do **not** import `@fontsource/shippori-mincho-b1/japanese-800.css`: it pulls in ~120 woff2 chunks, which the `woff2` glob would precache. Instead, at build time run `pyftsubset` (fonttools) on the 800-weight Japanese file, keeping only the glyphs the UI uses: `残心今稽古師書道一二三四五六七八九十`. That gives **one woff2 of about 10–20 KB**. Add an `@font-face { font-family: 'Shippori Mincho B1'; font-weight: 800; unicode-range: <those code points>; src: url(...) }`. The scene watermark, Hanko, hub kanji and stage seals then all render in the brand face on every device.
- **Optional brush accent** (OFL, on Fontsource): **Yuji Syuku** or **Yuji Boku** ([fontsource: Yuji Syuku](https://fontsource.org/fonts/yuji-syuku/about), [Yuji Boku](https://fontsource.org/fonts/yuji-boku/about)). A calligraphic face for the *large hall-banner kanji only*, subset the same way. Check the licence file in the package before adopting. Do not use it for labels.
- **Type scale for the nav:**

  | Element | Size / line height, weight |
  |---|---|
  | Dock labels | 11/14, 500 (active 600) |
  | Chips | 14/20, 500 |
  | Rail hubs | 15/20, 500 |
  | Rail children | 14/20, 400 |
  | Eyebrow | 11/16, 600, 0.14 em, uppercase |
  | Top-bar title | Shippori 800, 20/28 (phone) and 24/32 (desktop) |
  | Badges and kbd | Plex Mono 600, 11/18 and 12/20 |

  All line heights are on the 4 px grid.

---

### Sources

**Navigation**
- WHOOP: [navigation bar update](https://www.whoop.com/us/en/thelocker/app-update-navigation-bar), [the all new home screen](https://www.whoop.com/us/en/thelocker/the-all-new-whoop-home-screen/), [the5krunner on the Oct 2025 revamp](https://the5krunner.com/2025/10/15/whoop-homescreen-gets-a-revamp)
- Oura: [new app experience](https://ouraring.com/blog/new-oura-app-experience/), [9to5Google on the redesign](https://9to5google.com/2025/10/20/oura-app-redesign/)
- Strava: [BikeRadar](https://bikeradar.com/news/strava-beta-test-layout), [Triathlete](https://www.triathlete.com/gear/tech-wearables/strava-overhauls-app-layout-with-new-groups-you-and-maps-sections/)
- [Duolingo core tabs redesign](https://blog.duolingo.com/core-tabs-redesign)
- [Chess.com v4](https://www.chess.com/news/view/chesscom-v4-ios-android)
- [Linear personalised sidebar](https://linear.app/changelog/2024-12-18-personalized-sidebar)
- iOS 26 tab bars: [Donny Wals](https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/), [WWDC25 session 284](https://developer.apple.com/videos/play/wwdc2025/284/)
- [Material 3 Expressive navigation](https://9to5google.com/2025/05/14/material-3-expressive-navigation/)
- [Discord: improving our mobile experience](https://discord.com/blog/improving-our-mobile-experience)
- [Raycast fallback commands](https://manual.raycast.com/fallback-commands)

**Imagery and licences**
- [Unsplash License](https://unsplash.com/license), [Unsplash+ License](https://unsplash.com/plus/license)
- Unsplash API guidelines: [overview](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines), [triggering a download](https://help.unsplash.com/en/articles/2511258-guideline-triggering-a-download), [attribution](https://help.unsplash.com/en/articles/2511315-guideline-attribution), [hotlinking](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images)
- Unsplash search pages read: [torii-gate](https://unsplash.com/s/photos/torii-gate), [ink-in-water](https://unsplash.com/s/photos/ink-in-water), [washi-paper-texture](https://unsplash.com/s/photos/washi-paper-texture), [japan-at-night](https://unsplash.com/s/photos/japan-at-night), [katana](https://unsplash.com/s/photos/katana), [cherry-blossom-night](https://unsplash.com/s/photos/cherry-blossom-night), [moon-reflection](https://unsplash.com/s/photos/moon-reflection), [dojo](https://unsplash.com/s/photos/dojo), [japan-lantern](https://unsplash.com/s/photos/japan-lantern), [damascus-steel](https://unsplash.com/s/photos/damascus-steel), [karesansui](https://unsplash.com/s/photos/karesansui), [forge](https://unsplash.com/s/photos/forge), [illustrations: japanese-landscape](https://unsplash.com/s/illustrations/japanese-landscape)
- Fonts: [fontsource: Yuji Syuku](https://fontsource.org/fonts/yuji-syuku/about), [Yuji Boku](https://fontsource.org/fonts/yuji-boku/about)

**Blocked:** the Mobbin MCP (paid plan required); `https://mobbin.com/explore` (permission not granted); the Unsplash MCP (account email not confirmed); constructed Unsplash URLs such as `unsplash.com/s/photos/shrine-night`, `/misty-mountains` and `/photos/UWheXkRpWKI` (provenance rule).
