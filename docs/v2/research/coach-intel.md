# ZANSHIN 2.0 — Coach and Intelligence research

Personas: **Tekken Coach** (how to get from beginner to master with Yoshimitsu) and **Intelligence Architect** (AI features and the data behind them).
Date: 1 Nov 2026. Base: ZANSHIN 1.4.1 (`/home/claude/work/zanshin`, read only; nothing was changed, deployed or paid for).
Current game version in the app's data: 3.02.02 (`punishers.json` provenance); Season 3 started with Ver.3.00.00 on 17 Mar 2026.

**How this was researched.** Pages were opened with WebFetch. Wank's API was checked against its own `/api` page and against the source code of five open-source tools that use it (cloned from GitHub into the scratchpad). Some URLs could not be opened: `https://wank.wavu.wiki/` and `https://wank.wavu.wiki/player/search?...&_format=json` (WebFetch permission not granted in time), `https://wavu.wiki/t/Yoshimitsu` (same), and dotesports' 3.02.01 notes and games.gg's ranked guide (both sites returned errors). Bash could not reach `wank.wavu.wiki` either: the proxy refused the connection with a 403. So no live call to Wank was made from here. The Wank shapes below come from the `/api` page plus code and fixtures in tools that call it in production. Anything I could not confirm is marked **unverified**.

---

## 0. The short version

- **The curriculum is strong on Yoshimitsu's kit and on universal defense.** It has 10 stages, 50 nodes and 37 drills, from Calibration to Mastery, with Flash, Spin, Kincho, DGF, NSS, MED and Heat. What 1.4.1 lacks is the loop that the best coaching is built on: **real matches → review → a drill → re-test in real matches.** Ranked results are typed in by hand. Replay review only appears at Stage 8. Matchups are not prioritised by what Sagar actually meets. No drill trains recognising moves on reaction.
- **Ranked history can be imported for free.** Wank has no per-player JSON, but its player page is server-rendered HTML with stable class names, and two maintained tools already parse it. Wank's documented `/api/replays` endpoint can then fill in each match (in-game rank, Tekken Power, rounds, character ids), one request per 700-second window. ewgf.gg has a sanctioned JSON API with a free key: 100 requests/day, last 50 battles, 24 h delay. Both need Sagar's **Tekken ID**, and ewgf also needs his own free API key. Bandai Namco has no official API.
- **The 1.4.1 importer would fail as written.** It fetches `https://wank.wavu.wiki/<id>?_format=json`. The real path is `/player/<undashedId>`, and another project tested `?_format=json` on that page: it still returns HTML.
- **Recommended models.** Keep Perplexity's Agent API as the one paid path: Sonar with fast web search for research, Claude Haiku 5.5 as the default coach, Sonnet 5.5 for the weekly plan. Use JSON-schema structured outputs for anything that writes rows. Add Netlify AI Gateway only if vision turns out to need it. Use the browser's Web Speech API for voice. Typical costs are a tenth of a cent to 3 cents per call.
- **Two platform facts change 1.3.0 decisions.**
  1. Netlify's docs now give synchronous functions a **60 s** limit and 6 MB buffered payloads. The intel function's 9 s timeout, D-130-6 ("stop at 10 s"), is out of date.
  2. Perplexity ended **Sonar Chat Completions on 27 Sep 2026**. The app already uses the Agent API, so nothing breaks. But `sonar-pro`, `sonar-reasoning-pro` and `sonar-deep-research` are not Agent API model ids. Use the `effort` levels instead.

---

## 1. Coach: how strong players structure improvement

### 1.1 The common shape

The resources the community recommends follow nearly the same order: defense and punishment first, then movement and spacing, then neutral and offense, then knockdowns and walls, then matchups. Examples:

- r/Tekken's *Compiled Learning Resources* for Tekken 8 has sections in this order: Fundamentals → Frame Data → Neutral → Offense → Defense → Knockdown Situations → Getting Away From the Wall → Throws → Movement → Learning Matchups.
- Coach Kazama's six-session paid course runs Fundamentals → Spacing and whiff punishing → Heat and frame advantage → Block punishing and frames → Review FT5 → Advanced combos.
- TekkenDocs' Yoshimitsu guide is organised as top 10 moves, punishers by frame, combos, then knowledge checks.

The common principles:

1. **Defense before offense.** Hold back or down-back. Learn which moves are -10 or worse and punish them every time. Break throws by the arm the opponent uses (1, 2 or 1+2). Get up off the ground safely.
2. **Punishment is a lookup table that has to become reflex.** Know your fastest punisher at each frame value (i10, i12–13, i14, i15), standing and while standing (after blocking a low). Practise it with Tekken 8's own Punishment Training: Hit Analysis on, Attack Warnings on, Medium difficulty then Hard (esports.gg).
3. **Movement creates whiffs, and whiffs give the most damage.** Sidestep the right way against linear moves. Backdash and backdash-cancel (KBD) out of range, then whiff punish.
4. **Neutral is a rock-paper-scissors triangle (sansukumi).** Attack, block or step, and evade or whiff punish. Several resources are about not giving up your turn after a block, and not mashing.
5. **Knockdown and wall situations decide rounds.** Okizeme (pressure on a downed opponent): how to get up yourself, how to punish their tech-rolls and wake-up kicks, and how to escape the wall.
6. **Matchups come from your own losses.** Turn every move you lost to into a stock answer, a "canned response" in toptier.gg's words.
7. **Replay review is the habit that links all of it.** Sort damage taken into "bad" and "OK". Pause where you felt lost. Find missed punishes. Rebuild the situation in Practice mode. Watch strong players of your character (toptier.gg).

### 1.2 Each fundamental compared with 1.4.1

| Fundamental | What strong coaching does | 1.4.1 has | Gap |
|---|---|---|---|
| Blocking and guard levels | Default to down-back. Block lows on reaction to the animation | `n1-guard`, drill "Block a mid and a low on reaction" | No training to recognise moves on reaction (see feature F4) |
| Punishing blocked moves by frame | Punish ladder by frame, standing and crouching; in-game Punishment Training with Medium→Hard | `n1-punish`, `n1-punish-crouch`, `n3-punish*`, Punish Trainer, his ladder in `punishers.json` | Drills don't give the **exact in-game settings** (Hit Analysis, Attack Warnings, Medium→Hard). Opponent moves to punish come only from manual problem moves or on-demand imports |
| Whiff punishing | Space, make the move whiff, punish with long-range launchers | `n2-whiff`; TekkenDocs lists b+2,2 (i14), 3,1 (i15), df+2 (i15) | Fine |
| Sidestepping and its direction | Step against linear moves. Know each opponent's weak side and which of their moves track | `n2-sidestep`; problem-move answers include sidestep-left/right | Nothing says which way to step against a given opponent move. Wavu has only a Homing tag, not tracking data, so this has to be logged and verified by hand |
| Backdash and KBD | Backdash cancel in rhythm; space control | `n2-kbd`, drill "Backdash cancel" | Hands-free rep counting would help (F5) |
| Throw breaks | Break 1, 2 or 1+2 by the arm; chain throws per matchup | `n1-throws` (target 60% of breaks) | No matchup notes for chain throws (King, Nina, Armor King) |
| Low parry and ducking | Low parry with df at the right time; duck highs in strings; punish lows while standing | Drill "Punish after blocking a low", `n5-cd2` (CD2 under highs) | **No low-parry drill.** TekkenDocs lists a Yoshimitsu combo after low parry. No work on opponent strings (gaps, duckable highs) |
| Heat | Heat Engager confirms, Heat Dash/Smash, when to spend Heat | Stage 4 is complete. Season 3 changes: Heat Smash no longer wall splats; Heat Dash scaling | Re-check the Heat nodes against S3 notes; Patch Watch partly covers this |
| Walls, wakeup and oki | Escape the wall; read wake-ups; punish tech-rolls | `n1-wakeup`, `n7-wakeup`, `n3-enders`, `n7-staple` | **No "escape the wall" node** (defense at the wall) |
| Frame traps and conditioning | Teach the opponent to respect a gap, then exploit it | `n5-traps`, `n6-traps` | "Conditioning" is not taught as an idea, and no reads of opponent habits are recorded |
| Neutral decisions | Sansukumi, keep-out, stealing the turn | `n5-keepout`; playbook "Keepout", "Anti-turtle", "Anti-aggression" | **No neutral/sansukumi node** in Shu or early Ha |
| Matchup knowledge | Prioritise the characters you meet; their punishable moves, lows, plus frames, homing moves | Character pages, 30-day cached primers, problem moves, `n8-sheets` | No priority by exposure. Sheets are manual and arrive late (Stage 8) |
| Replay review | Weekly from day one; one theme per review; findings become drills | Review answers on the log-detail screen; `n8-review` at Stage 8 | **Starts far too late**, and nothing in the flow turns a moment into a problem move into a drill |
| Lab habits | Short, specific drills; record and playback; 2–3 random playback options | Lab sessions, Lab Mode, adaptation engine | Hands-free logging and a voice coach (F5) |
| Ranked mindset and tilt | Set a goal per session; stop-loss rules; review instead of grinding | `tiltGuard`: 5 logged losses in a row in one day | Only works if every loss is logged by hand. No pre-session goal. No Season 3 rank rules (see 1.6) |

### 1.3 Replay review method

The workflow most guides agree on:

1. Review **losses**, one theme at a time.
2. Note each piece of "bad damage", each moment of helplessness and each missed punish.
3. For each, write the answer (block, duck, step, punish with X, break 1+2) or go and find it.
4. Recreate it in Practice mode and drill it.
5. Re-test in ranked. (Sources: toptier.gg; r/Tekken's "Learning Matchups" section.)

Tekken 8's **My Replay & Tips** already marks moves that could have been punished or ducked, gives combo and throw-break tips, and lets you take over a replay for 10 s from any point (oneesports.gg). ZANSHIN shouldn't copy that. It should hold what the game does not: a list of moments → a problem move → a Lab drill → a flashcard → a check in later matches. 1.4.1 already has the problem-move pipeline (`ProblemMove` → `problem:<id>` Lab block + card). The review flow is the missing link into it.

### 1.4 Ranked mindset and the Season 3 rank rules

From the official Ver.3.00 patch notes and Techloy's summary:

- Each character has its own rank.
- Matchmaking uses the rank of the character in play.
- **Demotion requires two consecutive losses.** At the bottom of a rank, points stay at the minimum until a second loss.
- Promotion bonuses, win-streak bonuses (up to the rank below Bushin), and a new **Revenge Bonus** for winning a rematch after a loss.
- Default rank restriction is ±2.
- The result screen shows the point change in detail.

What this means for coaching: losing a rank is slow and recoverable, so Sagar can play to practise rather than to protect points. A session plan should say "one focus per session", set a stop-loss (for example 3 losses in a row, or N points down), and end with a 30-second reflection. The tilt guard in 1.4.1 should run on imported results instead of on manual logs.

### 1.5 Rank milestones (Beginner → God of Destruction)

The ladder in Wank's and ewgf's encoding (`0` Beginner … `25` Tekken King … `29` God of Destruction … `37` God of Destruction Infinity) is in `msullivan613/tekken-leaderboard` spec §7.5, and cfn-tracker's `wavu/model.go` agrees.

The percentiles below are each rank's share of players, added up from the top. They come from Esports Tales' 90-day Wank sample (Sep 2024: "average player is ranked at Garyu"; Fujin ≈ top 19.7%). Season 3 reset ranks, so treat them as rough.

| Rank band | ≈ top % (Sep 2024) | Suggested ZANSHIN gate |
|---|---|---|
| Beginner → Eliminator (0–14) | bottom ~50% | Stages 0–3 (Shu): defense, punish ladder, movement, core kit |
| Garyu / Shinryu / Tenryu (15–17) | 50% → 38% | Stage 4 (Heat) and the start of 5 (panic and keep-out) |
| Mighty / Flame / Battle Ruler (18–20) | 33% → 24% | Stages 5–6 (stance pressure: DGF, KIN, NSS) |
| Fujin → Bushin (21–24) | 20% → 8% | Stage 7 (oki, stances II) and exposure-driven matchup work |
| Tekken King → Tekken God Supreme (25–28) | 5% → 0.75% | Stage 8 (matchups, anti-turtle and anti-aggression plans) |
| God of Destruction (29+) | ~0.4% | Stage 9 (patches, tournaments, personal style) |

### 1.6 Yoshimitsu in Tekken 8

**Identity** (TekkenDocs, by TrizzyTheRapper, updated 30 May 2026 for 3.01.01): a jack of all trades. He has strong keep-out tools and panic tools (Flash 1+4, i6–9, the fastest move in the game; Manji Spin b+3/b+4, which costs his own health), strong oki, and stances with real 50/50s and plus frames. His weaknesses:

- He needs stances to open people up.
- He struggles against players who turtle.
- His pokes are mediocre.
- **He can be sidestepped to his right.**
- He rarely gets plus frames from lows or mids.

The bad habits TekkenDocs warns about: getting gimmicky against players who know the punish, using f+1+2 or Flash outside Heat or NSS, and having no homing move ready.

**Stances** (TekkenDocs; the app's `stances.json` has 10):

| Stance | Notation | Entry |
|---|---|---|
| Dragonfly | DGF | u+1+2, after 3,1 / 3~4 / fff+3 / Heat Smash |
| Indian | IND | d+3+4 |
| No Sword Stance | NSS | b+1+2; changes his moves and punishers |
| Kincho | KIN | 1+2 |
| Flea | FLE | d+1+2, KIN f+1+2 on block |

Also Meditation (MED), back-turned (BT), Bad Breath (BDS), WFL and 1SS.

**His health economy.** No guide I opened explains this. The app's own Codex (Wavu movelist notes) has it in detail:

- Many NSS-route and Heat weapon attacks recover "1 base health or 6 additional recoverable health on hit". Some recover more, for example H.2+3 Heat Smash: 4 base / 14 recoverable.
- MED.1+2 recovers 12 base health.
- Each IND.n pulse recovers 3 recoverable health.
- Spins cost his own health. qcb,f+2 costs him 35. The qcf+2 throw swaps health with the opponent.

This is a real decision skill: when to spend health on spins, and when to route into NSS to win it back. The curriculum covers it only generically, in `n4-recoverable` ("Recoverable health and Rage").

**What to learn first** (TekkenDocs top moves, matched to Stages 3–5):

- Punishers: 1,1 (i10), 2,2 (i11), df+1,4 (i13), b+2,2 (i14, Heat Engager), df+2 (i15 launcher)
- While standing (after blocking a low): WS4 (i11), WS1,2 (i13), WS2,1 (i15 launcher)
- df+4 (i12 mid poke), df+1 (i13, -4), 3~4, SS1, 3,1, db+3,3(,4), uf+4 (homing, low crush), BDS 1, f,f+4
- Panic tools: 1+4 and b+3/b+4

The beginner combo is df+2 / uf+3 → D2,2 → Df1,2,1 → D2,2,2.

Every one of these is in the app as Wavu-verified data, so the coach should cite the Codex, not the web, for frame numbers. That rule is already the 1.3.0 policy.

### 1.7 What 1.4.1 is missing, in order of impact

1. **A loop from real matches into training.** Results are entered by hand, so the weakness engine, tilt guard and weekly review starve. (F1)
2. **Replay review as a weekly habit from Stage 0–1**, with a capture flow that turns a moment into a problem move. (F2)
3. **Matchup work prioritised by exposure**, with sheets generated from data Sagar already has (Wavu opponent movelists). (F3)
4. **Recognising moves on reaction.** The common lows, mids and string enders of the characters he meets, on sight. (F4)
5. **Lab Mode he can use with a controller in his hands**: voice prompts, spoken rep counts, logging reps by voice. (F5)
6. **Missing nodes**: neutral and sansukumi (Shu/Ha), escaping the wall, low parry, conditioning, and his health economy. (F9)
7. **Sessions planned around rank**: Season 3 rules, a stop-loss, rank milestones linked to the stages. (F6)
8. **Study of strong Yoshimitsu players' videos**, with a "steal one thing" template. (F10)

---

## 2. Data sources for Sagar's own ranked history

### 2.1 Wavu Wank (`wank.wavu.wiki`) — free, no key

**Its own documentation** (`/api`, opened):

- `GET /api/replays?before=<unix>` returns replays with `before − 700 s < battle_at ≤ before`, newest first, about 5,000 per response.
  - `before` defaults to the newest replay in the database.
  - You need to send `Accept-Encoding: gzip`, because the `/api/*` endpoints require compression.
  - `p1_name` and `p2_name` are the players' **current** names, not the names they used at the time.
- `GET /api/ratings?before=<unix>` works the same way but on the ratings table's `last_seen`. Deviation decay is not applied; you compute it yourself every 4 days of inactivity (`decay_deviation` in the skillratings crate).
- **Rate limits** cover the whole site, with no exception for the API, and no numbers are published. The courtesy rule: a client that makes **one request at a time** should never hit the limit. Stepping back 700 s per second can fetch a month of replays in about an hour.
- The page says "some requests produce JSON if you add `?_format=json`".
- Database size shown: 662,593,566 games since 27 Mar 2024.
- There are no terms of use beyond a fair-use and non-affiliation note, and no contact address.

**Replay record shape.** This is the real-record fixture in `aarminani/mu-rating-hud` `replays.rs` (Sep 2026), which matches cfn-tracker's `model.go`:

```json
{"battle_at":1789211804,"battle_id":"x","battle_type":2,"game_version":30202,
 "p1_area_id":3,"p1_chara_id":14,"p1_lang":"en","p1_name":"…","p1_polaris_id":"xxxxxxxxxxxx",
 "p1_power":407811,"p1_rank":33,"p1_rating_before":2111,"p1_rating_change":7,"p1_region_id":3,
 "p1_rounds":3,"p1_user_id":1, "p2_…": "same fields", "stage_id":100,"winner":1}
```

- `battle_type`: 1 = quick/casual, 2 = ranked.
- `winner`: 1 or 2.
- `*_rank` is the in-game rank on the 0–37 ladder.
- `*_power` is Tekken Power.
- `*_rating_*` is Wank's Glicko rating, and can be null.
- `game_version` 30202 means 3.02.02.
- Character ids: **Yoshimitsu = 3**. The full map, including Armor King 44, Miary Zo 45, Kunimitsu 46 and Bob 47, is in tekken-leaderboard spec §7.6.
- cfn-tracker says "Wavu dropped `battle_id` from the API", but the Sep 2026 fixture has it. So treat `battle_id` as optional and dedupe on `battle_at + p1_polaris_id + p2_polaris_id`.

**Per-player data is HTML only.**

- tekken-leaderboard spec §7.3, verified 30 Jun 2026: "`?_format=json` returns the **HTML page** (Content-Type text/html)". `/api/replays` is the global stream, not per player.
- TRB12's scraper says the same: "there's no JSON API, so we fetch the page".
- URL: `https://wank.wavu.wiki/player/<12-char undashed Tekken ID>`.
- Search: `GET /player/search?q=<name>`, with rows under `#search-results table tbody tr` linking to `/player/<id>`.
- The page is server-rendered; htmx handles pagination. Stable selectors used by two maintained parsers (TRB12, Jul 2026; mu-rating-hud, Oct 2026):

**Ratings card.** Each `.rating-group` has a `.label` (Leaderboard σ² < 75 / Unqualified σ² < 110 / Provisional), and each `.rating` inside it has:
  - `.char`
  - `.mu` (text "μ 1715")
  - `.sigma` ("σ² 68")
  - `.games` ("559 games")
  - `.last-seen` (`printDate(<unix>)`)

**Match list.** `div.game-list > table > tr`, one row per match:

```html
<td class="battle-at">…<script>printDateTime(1789261702)</script></td>
<td class="left"><span class="player"><a href="/player/…">Me</a></span><span class="char">Yoshimitsu</span>
  <span class="rating"> 2244 <span class="win"> +5 </span></span></td>
<td class="result"> 3-1 </td>
<td class="right"><span class="rating"> 2067 <span class="lose"> -6 </span></span><span class="char">Lili</span>
  <span class="player"><a href="/player/<opponent id>">…</a></span></td>
```

From that row you get:

- the time
- Sagar's character
- his Wank rating and its change
- the round score
- win, lose or draw (the class name)
- the opponent's character, name, Tekken ID and rating

Not on the page: the in-game rank (**unverified** whether it appears) and the stage. Form fields seen on the page: `<select name="char">` and `<select name="opp_char">`, with slugs such as `alisa`, `ak`, `miary`, `jack`. So filtered views probably exist. **Unverified:** the exact query strings, and how many rows the first page holds.

**Getting in-game rank and Tekken Power for each imported match.** For each new match time `t`, fetch `/api/replays?before=t+1`, which is the 700 s window that contains it, and find Sagar's Tekken ID. One request covers every match in that window, so an hour of play costs about 6 requests at 1 per second.

**CORS:** not documented, and I could not test it. Run every call **in the Netlify Function**. That avoids CORS entirely and lets Blobs cache the results. The app's CSP (`connect-src 'self' https:`) is not the blocker.

**Courtesy plan:**

- one sync per session, plus a manual "Sync now"
- a descriptive `User-Agent` with a contact
- requests one at a time, spaced ≥10 s apart for player pages (mu-rating-hud spaces them 10 s apart)
- 1 per second for `/api/replays`
- cache the player page in Blobs for 10 minutes
- credit Wank by name (its maintainer is 6weetbix, per mu-rating-hud's README)

**Freshness:** Wank collects replays continuously; I saw no stated delay. Wank only has data from 27 Mar 2024 on.

### 2.2 ewgf.gg — sanctioned JSON API, free key (api-docs, opened)

- Base `https://api.ewgf.gg`. Every call needs `Authorization: Bearer <token>`. You create an account, then go to Settings → Developer to generate the token.
- `GET /external/battles/{tekkenId}`: recent battles. `GET /external/profile/{tekkenId}` and `POST /external/profile` (bulk) return profile data.
- Every response has `_metadata.{rate_limit_remaining, rate_limit_reset, tier}`.
- Errors: 400 bad ID, 401 bad token, 404 unknown player, 429 with `Retry-After`.
- **Free tier:** 100 requests/day, the **last 50 battles, 24 h delayed**. Pro is $10/mo: 1,000 per day, last 100, no delay. tekken-leaderboard found the profile endpoints effectively Pro-only.
- **Battle shape** (tekken-leaderboard §7.2, "verified live"):
  - `battle_at` (ISO, UTC)
  - `battle_type` (`RANKED_BATTLE` / `QUICK_BATTLE` / `PLAYER_BATTLE` / `GROUP_BATTLE`)
  - `game_version`, `winner`, `stage_id`
  - for each player: `name`, `tekken_id` (undashed), `char` (display name), `region`, `dan_rank` (display name, e.g. "Tekken God"), `tekken_power`, `rounds_won`
  - no `battle_id`
- CORS: not documented. The key must stay on the server anyway. Store it as `EWGF_API_KEY` on Netlify, not pasted into the app as `fetchEwgfBattles` does today.

### 2.3 Other sources

- **tknow.gg** (`api.tk8now.pe.kr/api/v1`). It has per-character in-game ranks with lifetime totals, and paginated match history with a real `battle_id`. But it answers 403 unless the request **forges** `Origin`/`Referer: https://www.tknow.gg`, which is an anti-hotlinking check (tekken-leaderboard §7.9). **Not recommended** for ZANSHIN. Use it only if its developer (min2hound) agrees.
- **Official Bandai Namco:** I found no public player-data API and no "My Tekken" web page with match history. ewgf.gg says some of its data comes "from Tekken servers", but does not say how.
  - In the game: the Tekken ID is a 12-character code shown dashed (`xxxx-xxxx-xxxx`) on the Replay menu and the profile. Wank uses it undashed.
  - My Replay & Tips keeps replays inside the game. There is no replay-file export, so clips only exist as screen captures (PS5 Create button, or Steam/NVIDIA capture on PC).
- **"tekkenstats":** nothing I found is a public service with an API. Results were student or hobby projects built on Wank's `/api/replays`.

### 2.4 Recommendation for importing ranked history

| Option | Cost | Key | Same-day? | Fields | Fragility | Verdict |
|---|---|---|---|---|---|---|
| Wank player page, plus `/api/replays` windows for detail | Free | None; **needs Tekken ID** | Yes | Time, both characters, W/L/D, rounds, Wank μ and change, opponent ID; in-game rank and power from the replay window | HTML markup (two maintained parsers prove it stable) | **Primary** |
| ewgf `/external/battles` | Free (100/day) | **Sagar's free ewgf token**, plus Tekken ID | No (24 h on free) | Clean JSON, rank names, Tekken Power, battle type | Low | **Fallback and cross-check** |
| tknow.gg | Free | Forged headers | Yes | Best (battle_id, lifetime games) | ToS grey area | Don't |
| Global `/api/replays` sample (monthly CI job) | Free | None | n/a | Which characters appear at each rank band | Low | For matchup priority (F3) |

What Sagar needs to provide:

- his **Tekken ID** (from the in-game profile or Replay menu)
- *optionally* an ewgf.gg account and token, set as a Netlify environment variable (only the repository owner can do this)
- which platform he plays Tekken on, PS5 or PC, which decides how he captures clips (F8)

Fix the 1.4.1 adapter (`src/data/import/matches.ts`): path `/player/<undashed id>`, HTML parsing, run on the server, keep `importRef = battle_at:p1:p2`.

---

## 3. Models: options, costs, availability

### 3.1 Perplexity Agent API (what ZANSHIN uses now)

- Endpoint `POST https://api.perplexity.ai/v1/agent`. The March 2026 launch post says models are billed at the providers' prices "with no markup".
- **Model prices per 1M tokens, input / output** (from `docs/agent-api/models`):

  | Model | Input | Output |
  |---|---|---|
  | `perplexity/sonar` | $0.25 | $2.50 |
  | `anthropic/claude-haiku-5-5` (up to 100k tokens) | $0.10 | $0.50 |
  | `anthropic/claude-sonnet-5-5` | $2 | $10 |
  | `anthropic/claude-opus-5-5` | $4 | $20 |
  | `openai/gpt-6-luna` | $0.10 | $0.50 |
  | `google/gemini-3.8-flash` | $0.75 | $3.75 |
  | `google/gemini-4-argon` (introductory until 30 Nov 2026) | $2 | $10 |

  Anthropic models require `max_output_tokens`. A `flex` tier costs 0.5× on the models that offer it.
- **Tools** (pricing page):

  | Tool | Price per call |
  |---|---|
  | `web_search` standard | $0.0025 |
  | `web_search` fast (`search_type:"fast"`, what the app uses) | $0.001 |
  | `fetch_url` | $0.0005 |
  | `image_search` | $0.0025 |

  Embeddings: `pplx-embed-v1-0.6b` costs $0.004 per 1M tokens.
- **Structured outputs:** `response_format: {type:"json_schema", json_schema:{name, schema}}` on `/v1/agent`. The docs advise against asking for links inside the JSON; take them from `search_results` instead.
- **Effort levels** take the place of named presets. Pass `effort` = `fast` / `low` / `medium` / `high` / `xhigh`:
  - `fast`: gpt-6-luna, 1 step, fast search
  - `medium`: gpt-6-luna, 15 steps, plus `fetch_url`
  - `high`: gpt-6.1-terra, 40 steps
  - `xhigh`: claude-opus-5-5, 300 steps

  The docs give no per-request cost band.
- **The Sonar product line:**
  - The docs say "Sonar Chat Completions support ended on September 27, 2026". Synchronous calls are being converted to Agent API requests, and asynchronous Sonar is no longer supported.
  - Older Sonar-API prices, from a third-party summary dated Jun 2026, for reference:
    - sonar: $1 / $1 plus a request fee of $5–12 per 1K
    - sonar-pro: $3 / $15
    - sonar-reasoning-pro and sonar-deep-research: $2 / $8, with deep-research extras ($2/M citation tokens, $3/M reasoning tokens, $5 per 1K searches)
    - `sonar-reasoning` (non-pro) was no longer listed.
  - **For ZANSHIN:** `perplexity/sonar` on the Agent API is the cheap grounded model. "Pro" or "deep research" now means `effort: low` or `medium` with a stronger model.
- **Image input on `/v1/agent`: undocumented.** Test it with one small call before building vision on this path.

**Cost per call at today's settings** (my estimates from the prompts and limits in `src/server/intel/prompts.ts`):

| Call | Model | Approx. tokens | Approx. cost |
|---|---|---|---|
| Look it up (6 results, ≤5k search tokens) | sonar + fast search | 5.5k in / 0.3k out | **$0.003** |
| Matchup primer | sonar | 6k / 0.55k | $0.003 |
| Matchup primer | sonnet-5-5 | 6k / 0.55k | $0.02 |
| Coach answer or weekly review (≤6k context) | haiku-5-5 | 6k / 0.6k | **$0.001** |
| Coach answer or weekly review | sonnet-5-5 | 6k / 0.6k | $0.018 |
| Structured weekly plan (JSON) | sonnet-5-5 | 8k / 1.5k | ~$0.03 |

At the $3/day cap, that is about 1,000 research answers or 3,000 Haiku answers a day. **The cap is not the constraint; content quality is.**

### 3.2 Netlify AI Gateway (`docs.netlify.com/build/ai-gateway/overview`)

**How a function uses it.** Netlify injects `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY` + `OPENAI_BASE_URL`, `GEMINI_API_KEY` + `GOOGLE_GEMINI_BASE_URL`, and `OPENROUTER_*` into every Function, Edge Function and the Vite plugin. `NETLIFY_AI_GATEWAY_KEY` and `NETLIFY_AI_GATEWAY_URL` are always set. `new Anthropic()` or `new OpenAI()` then works with no key of your own, and keys you set yourself take precedence.

**Providers:**

- served directly: Anthropic, OpenAI, Google Gemini, Meta Muse, TypeSafe
- through OpenRouter: xAI, DeepSeek, Mistral, Qwen and others, routed only to zero-data-retention hosts
- recent additions (changelog): Claude Haiku 5.5 (7 Oct), Gemini 4 Argon (13 Oct), GPT-6.1 Terra (26 Oct), OpenAI Decisions API beta on gpt-6-luna (7 Oct), image models

**Billing:**

- **Credit-based plans only** (Free, Personal, Pro).
- Usage is priced at the providers' rates, then **$1 = 180 credits**, from the same pool as the plan's credits.
- Plans include 300 credits (Free, hard limit, no top-up), 1,000 (Personal, top-up at $5 per 500) and 3,000+ (Pro).
- Rate limits per minute: 90 (Free), 450 (Personal), 1,800 (Pro) credits.

**Watch the shared pool.** The same credits pay for deploys, at **15 credits per production deploy**, plus compute and bandwidth. On a Free plan, 20 CI deploys a month would use all 300 credits. Check Sagar's plan (and whether it is credit-based at all) before relying on the gateway.

**Limits:**

- needs one production deploy first
- 200k-token input limit
- Claude caching: 5-minute only
- no request-header pass-through
- no batch API
- no OpenAI priority processing
- streaming, vision and structured outputs aren't mentioned, though the official SDKs are proxied, so they should work. **Verify with one test call.**

**Where it fits ZANSHIN:** only as a second path for **vision**, and only if Perplexity's `/v1/agent` turns out not to take images, or for Gemini **video**. Otherwise it adds a second budget to watch with no gain, because Perplexity already reports cost per call and the daily cap counts it.

### 3.3 Netlify Function limits, which affect 1.3.0 decisions (`docs.netlify.com/build/functions/configuration`)

- **Synchronous limit: 60 s.** Background: 15 minutes. Scheduled: 30 s. These cannot be changed.
- Buffered request/response payload: **6 MB** (about 4.5 MB of binary after Base64). Streamed response: 20 MB. Background functions: 256 KB.
- So the intel function's `timeoutMs: 9000` and D-130-6 are out of date. **Raise the timeout to about 45 s.** That lets Sonnet answers and `effort: low` research finish without needing edge functions.
- A video clip must be trimmed or cut into frames **in the browser** before upload, to stay under 4.5 MB.

### 3.4 Vision and video for replay clips or screenshots

**Claude (Haiku, Sonnet, Opus 5.5 all accept images; no video input):**

- Cost = ⌈w/28⌉ × ⌈h/28⌉ visual tokens. Claude 4.7 and later downscale to a long edge of 2,576 px, max 4,784 tokens.
- A 1280×720 frame is about **1,196 tokens**.
- 8 frames ≈ 9.6k tokens: about **$0.001 on Haiku 5.5** and **$0.02 on Sonnet 5.5**.
- One photo of the results or rank screen on Haiku is about $0.0002.
- JPEG, PNG, GIF (first frame only), WebP. Up to 10 MB per image and 600 images per request on the first-party API.

**Gemini (video input):**

- Default sampling is 1 fps at about 100 tokens/s (low resolution) or about 300 (high). The same page also says 263 tokens/s. Audio is 32 tokens/s. A custom fps scales the cost proportionally.
- `gemini-3.8-flash` costs $0.75 in / $3.75 out per 1M **until 31 Dec 2026, then doubles** (ai.google.dev pricing; eesel.ai). Thinking tokens bill as output. eesel reports slow time to first token (about 13 s).
- A 20 s clip at the default rate is about 6k tokens: **≈ $0.006** (≈ $0.013 from 2027). At 5 fps, ≈ $0.025.
- Either inline video bytes under the 4.5 MB function limit, or frames extracted in the browser.

**Honest limits:** a general vision model sampling at 1–5 fps **cannot** judge frame-precise Tekken interactions ("was that -13?"). It is good at reading **on-screen text** (results screen, rank, Practice mode's frame meter, the move-list overlay) and at coarse situations (knockdown, wall, Heat, who won the round, health bars). Build vision features around those, with the 1.3.0 "web-sourced, verify in Practice" badge. Frame data still comes only from Wavu.

**Pipeline that fits ZANSHIN's rules:**

1. The browser takes frames from a clip in the media library (canvas from `<video>`).
2. Sagar marks the moment.
3. The function sends 4–8 frames plus his note plus Codex context to Haiku 5.5 (or Sonnet 5.5), using a JSON schema.
4. The answer becomes a *suggested* problem move, which he confirms.

### 3.5 Speech for a voice coach in Lab sessions

**Web Speech API, `speechSynthesis` (free):**

- Baseline widely available since 2021: Safari/iOS 7+, Chrome 33+, Edge 14+, Firefox 49+.
- Quirks (Readium's notes):
  - Chrome **desktop** voices are online-only, and utterances longer than about 14 s break.
  - iOS browsers all use Safari's engine. Siri-quality voices are not exposed.
  - Android voice lists are messy, and Edge on Android returns no voices.
  - `localService` tells you whether a voice works offline.
- Fine for short dynamic cues ("Set 2. Ten reps. Punish minus thirteen with d/f+1,4").

**`SpeechRecognition` for hands-free logging ("hit", "miss", "next"):**

- Chrome 25+ (audio goes to Google's servers), Edge 87+ (Azure), Safari 14.1+ / iOS 14.5+. Firefox has it behind a flag.
- It needs a user gesture to start. Chrome ends after about 60 s of silence, so restart it in `onend`.
- `processLocally` is experimental.
- Always keep large on-screen buttons as the fallback.

**ElevenLabs, pre-rendered:**

- Flash/Turbo and v3 Conversational: $0.04 per 1K characters. Multilingual v2–v4: $0.08 per 1K.
- The free tier includes 20,000 Flash characters a month. Starter is $6/mo with 150k.
- A fixed library of about 150 cues × 40 characters is about 6k characters: inside the free tier, ≈ $0.24 at paid rates.
- Render once (Sagar's account, his approval), ship as static files in `/media`, and they work offline.
- **Recommendation:** Web Speech first (no cost, works today). Add an ElevenLabs cue pack later only if the system voices sound bad on his phone.

### 3.6 Recommended model setup

| Job | Model / route | Why |
|---|---|---|
| Look it up, primers, patch briefs | `perplexity/sonar` + fast `web_search` on `/v1/agent` (as now) | Grounded and cited; ≈ $0.003 |
| Coach Ask and quick debriefs | `anthropic/claude-haiku-5-5` (default, as now) | ≈ $0.001; good enough with Codex context |
| Weekly review and plan synthesis | `anthropic/claude-sonnet-5-5` with **`response_format` json_schema** | Typed output the planner can accept; ≈ $0.03 per week |
| Structured extraction (review moments, result screenshots) | Haiku 5.5 + json_schema (+ images if `/v1/agent` takes them) | Cheap and typed |
| Occasional deep research (a new patch, a new character) | `effort: "low"` or `"medium"` on `/v1/agent` | `sonar-pro` and deep-research ids are gone from the Agent model list |
| Vision fallback | Netlify AI Gateway → Anthropic SDK (`claude-haiku-5-5`) | Only if Agent API image input fails, and only on a credit-based plan with credits to spare |
| Video (experimental) | Gemini 3.8 Flash via the gateway, ≤20 s, frames or a trimmed clip | ≈ $0.006 per clip in 2026; doubles in 2027 |
| Semantic Codex search | `pplx-embed-v1-0.6b`, precomputed in CI | All 319 moves embed for about $0.0001; needs a GitHub secret only the owner can add |
| Voice | Web Speech synthesis + recognition | Free; optional ElevenLabs cue pack |

Also: raise the function timeout to about 45 s (§3.3), keep the $3/day cap, and widen the research allowlist only on purpose. Adding `ewgf.gg` or `wank.wavu.wiki` to `TEKKEN_SOURCES` is not needed, because those are API sources, not prose sources.

---

## 4. Proposed 2.0 features (prioritised; ★ = top 5)

| # | Feature | What it does for Sagar | Data / model | Feasibility | Size |
|---|---|---|---|---|---|
| ★ F1 | **Ranked Sync** | Imports his ranked matches with no typing. Each match becomes a log row (opponent character, opponent rank, W/L, rounds, rating change, time), grouped into sessions. Rank and rating trend charts. Tilt guard, weekly review and weakness engine run on real data. Rank milestones (§1.5) shown against the Path | Wank player page + `/api/replays` windows (server side, Blobs cache); ewgf as fallback | Free. **Needs his Tekken ID**; ewgf needs his free token as a Netlify env var | M |
| ★ F2 | **Review loop from day one** | After a session, picks 1–3 losses from the sync. Guides him through My Replay & Tips with a 4-tap moment template (situation · what hit him · answer type · confidence) → creates a problem move → Lab drill + card (pipeline exists) → checks for the same moment in later matches. Moves `n8-review` into Stage 1 | Synced matches; optional Haiku + json_schema "which move was this?" against the opponent's imported Wavu moves | Free; AI assist ≈ $0.001 per moment | M |
| ★ F3 | **Matchup queue and auto sheets** | Ranks the 41 opponents by how often he meets them and how often he loses (his history), weighted by how common each is at his rank band (monthly CI sample of `/api/replays`). For the top 5, builds a sheet from their Wavu moves: launch-punishable on block, -10…-14 with his punisher from `punishers.json`, lows that are punishable while standing, plus-frame and homing moves, power crushes, strings with gaps or duckable highs (from Wavu notes such as "Jail" and "Combo from 1st hit"). Feeds the Punish Trainer and cards. Primer prose (web) stays separate | Wavu Cargo (existing importer), Wank, punishers pack; primer via Sonar | Free (primer ≈ $0.003) | L |
| ★ F4 | **Recognition trainer** | Plays opponents' move clips (Wavu clips the media script already downloads with `--opponents`), randomised, with a timer. He answers block low / block mid / duck / step L-R / punish with X. Scores accuracy and reaction time per move and per character, and feeds the weakness engine. This trains on-sight recognition for the moves he meets (F3 chooses which) | Media library + opponent move data; no model | Free | M |
| ★ F5 | **Voice coach and hands-free Lab Mode** | Speaks block steps, targets, rep counts, rest timers and side switches. Optionally randomised reaction cues. Logs reps by voice ("hit", "miss") with large-button fallback, so his hands stay on the controller | Web Speech synthesis + recognition; optional ElevenLabs pack | Free; ElevenLabs optional (his account) | S–M |
| F6 | Ranked session protocol | One focus before he queues (from Today), stop-loss rules (3 losses in a row, or −N points), reset prompts between sets, Season 3 rank rules explained (demotion needs 2 losses, Revenge Bonus), 30-second reflection at the end | Ranked Sync + rules engine | Free | S |
| F7 | Coach 2.0 structured weekly plan | The weekly review returns a typed plan (focus nodes, drills, matchup queue, one ranked goal, one replay theme) that Today can accept or change, instead of prose | Sonnet 5.5 + json_schema on `/v1/agent` | ≈ $0.03 per week | M |
| F8 | Screenshot capture | Photo or PS5/PC screenshot of the results screen, rank screen or Practice frame meter → extracts opponent, rank and score, or an observed frame value for a Codex verification record (marked observed, not sourced) | Claude Haiku 5.5 vision (path to be tested, §3.1/3.2) | ≈ $0.0002 per image; may need a credit-based Netlify plan | M |
| F9 | Curriculum 2.0 nodes | Adds neutral and sansukumi (Shu), low parry plus his follow-up, escaping the wall, conditioning, **Yoshimitsu's health economy** (spin cost, NSS and Heat health recovery, MED.1+2 heal, IND pulses, qcb,f+2 cost; all from Codex notes), and in-game Practice settings for each drill (Punishment Training: Hit Analysis, Attack Warnings, Medium→Hard) | Packs only | Free | S–M |
| F10 | Study queue for strong players' videos | Look it up finds recent Yoshimitsu tournament or high-rank videos (YouTube is already in the allowlist). Kept as study notes with a "steal one thing" field that can become a Playbook entry | Sonar + fast search | ≈ $0.003 per search | S |
| F11 | Clip coach (experimental) | From a ≤20 s clip he marks a moment. 4–8 frames from the browser → model describes the situation and suggests answers, badged "verify in Practice" | Claude Sonnet 5.5 frames, or Gemini 3.8 Flash video | $0.005–0.03 per clip; low reliability for frame-precise reads | L |
| F12 | Patch-aware re-verification | When Patch Watch applies an update that touches his punishers or core moves, adds verify blocks to Today automatically, and marks the affected flashcards as due | Existing Patch Watch + planner | Free | S |

**Why these five.** F1 is the base for everything that adapts. F2 turns losses into drills, which is the biggest single improvement lever. F3 and F4 turn 41 matchups into a short, prioritised, trained list. F5 removes the friction of logging Lab reps with his hands on the controller. F6, F7 and F9 are cheap to add once F1 exists.

**Suggested order:** F1 → F2 → F5 → F3 → F4, with F9 and F6 shipped alongside (both S).

---

## 5. Open questions for Sagar

1. His Tekken ID (12 characters), and whether he is OK with the site's function fetching his public Wank page once per session.
2. Whether he wants to create a free ewgf.gg account and token (it goes in as a Netlify environment variable, which only he can add).
3. Platform: PS5 Pro or PC? This decides how clips and screenshots get to the phone (F8, F11). Memory says he owns a PS5 Pro and a high-end laptop, but not which one he plays Tekken on.
4. His Netlify plan: is it credit-based, and how much of the monthly credit do deploys use? This decides whether AI Gateway is worth turning on.
5. Voice: is the phone's system voice acceptable, or does he want a pre-rendered ElevenLabs cue pack (his account, his approval to generate)?

---

## Sources (pages and files actually opened)

**Wank, ewgf and other data sources**
- Wavu Wank API docs: https://wank.wavu.wiki/api
- ewgf.gg API docs: https://ewgf.gg/api-docs · About: https://ewgf.gg/about
- cfn-tracker, Wank client and model (`app/pkg/tracker/t8/wavu/client.go`, `model.go`): https://github.com/williamsjokvist/cfn-tracker
- mu-rating-hud, `/api/replays` record fixture, player page parser, 10 s spacing, credits: https://github.com/aarminani/mu-rating-hud
- TRB12, player page and search scraper (`Services/WavuWankService.cs`): https://github.com/Faga250885/TRB12
- Tekken-8-Data-Tools, replay downloader and character id enum: https://github.com/chiefeelface/Tekken-8-Data-Tools
- wavubot, player search usage: https://github.com/Mugsworth1/wavubot
- tekken-leaderboard spec §7, live checks of ewgf, Wank and tknow (Jun–Jul 2026): https://github.com/msullivan613/tekken-leaderboard (`spec/07-external-api-reference.md`)

**Coaching and Yoshimitsu**
- TekkenDocs Yoshimitsu Season 3 guide (TrizzyTheRapper, 30 May 2026): https://tekkendocs.com/yoshimitsu/guide
- DashFight Yoshimitsu guide by Trizzy (Apr 2024): https://dashfight.com/news/tekken-8-yoshimitsu-guide-by-trizzy-the-rapper-5550
- r/Tekken Compiled Learning Resources (T8), via a mirror: https://lr.eu.psf.lt/r/Tekken/wiki/beginner-resources-t8
- Coach Kazama, "Ultimate Tekken 8 guide to improving fast" (Metafy): https://metafy.gg/@coach-kazama/sessions/ultimate-tekken-8-guide-to-improving-fast--NJ7FfqAv7x9
- Esports Tales rank distribution and point system (Wank data, Sep 2024): https://www.esportstales.com/tekken/rank-distribution-percentage-of-players-and-point-system
- esports.gg, health in Tekken 8: https://esports.gg/guides/tekken-8/health-in-tekken-8-explained
- esports.gg, block punishment (Punishment Training settings): https://esports.gg/guides/tekken-8/how-to-block-punish-in-tekken-8
- esports.gg, low parry: https://esports.gg/guides/tekken-8/how-to-low-parry-in-tekken-8/
- ONE Esports, My Replay & Tips: https://www.oneesports.gg/tekken/tekken-8-replays-and-tips/
- toptier.gg, using replays to improve: https://toptier.gg/how-to-use-replays-to-improve-at-fighting-games
- Bandai Namco, TEKKEN 8 patch notes v3.00: https://www.bandainamcoent.com/news/tekken-8-patch-notes-v3-00
- Techloy, Season 3 ranked overhaul: https://www.techloy.com/tekken-8-season-3-patch-notes-update-3-00-00-brings-ranked-overhaul-heat-system-changes.md
- r/Tekken sidestep thread (no Yoshimitsu content): https://lr.us.psf.lt/r/Tekken/comments/1erwwrv/updated_side_step_guide/li3lsba/?context=3

**Perplexity**
- Pricing (tools, Search, Embeddings): https://docs.perplexity.ai/guides/pricing.md · https://docs.perplexity.ai/getting-started/pricing
- Agent API models and prices: https://docs.perplexity.ai/docs/agent-api/models.md
- Structured output: https://docs.perplexity.ai/docs/agent-api/building-agents/shape-output.md
- Effort levels: https://docs.perplexity.ai/docs/agent-api/presets.md
- Sonar features and deprecation: https://docs.perplexity.ai/docs/sonar/features.md
- Agent API announcement (Mar 2026): https://community.perplexity.ai/t/introducing-the-agent-api-a-managed-runtime-for-agentic-workflows/4733
- Third-party Sonar price summary (Jun 2026): https://developer.puter.com/tutorials/perplexity-api-pricing/

**Netlify**
- AI Gateway overview: https://docs.netlify.com/build/ai-gateway/overview · product page: https://netlify.com/platform/ai-gateway · changelog: https://main--www.netlify.com/changelog/tag/ai-gateway/
- Pricing for AI features: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/pricing-for-ai-features
- Credit-based plans: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- Gateway price cut (Sep 2026): https://www.usagepricing.com/blueprint/activity/netlify-2026-09-07-ai-gateway-price-cut
- Functions configuration and limits: https://docs.netlify.com/build/functions/configuration · overview: https://docs.netlify.com/functions/build

**Claude, Gemini, speech**
- Claude pricing: https://platform.claude.com/docs/en/about-claude/pricing.md · vision: https://platform.claude.com/docs/en/build-with-claude/vision.md · docs index: https://platform.claude.com/llms.txt
- Gemini tokens (video, audio, images): https://ai.google.dev/gemini-api/docs/tokens · pricing: https://ai.google.dev/pricing?hl=fi · Gemini 3.8 Flash pricing review: https://eesel.ai/blog/gemini-3-8-flash-pricing
- ElevenLabs API pricing: https://elevenlabs.io/sv/pricing/api
- Speech synthesis Baseline: https://web-platform-dx.github.io/web-features-explorer/features/speech-synthesis/
- Readium, Web Speech quirks: https://readium.org/speech/docs/WebSpeech.html
- SpeechRecognition support: https://www.testmuai.com/learning-hub/speech-recognition-api-browser-support/ · MDN `processLocally`: https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally

**ZANSHIN repository (read only)**
- `README.md`, `docs/RELEASE_1.3.0.md`, `docs/RELEASE_1.4.1.md`, `netlify/functions/intel.mts`, `src/server/intel/{perplexity,prompts,handler}.ts`, `src/domain/intel/models.ts`, `src/data/import/matches.ts`, `src/data/schemas.ts`, `src/data/packs/{curriculum,stances,punishers,moves.yoshimitsu}.json`, `src/domain/engine/{weakness,plan,adapt}.ts`, `src/domain/coach/context.ts`, `src/services/{matchups,punish}.ts`, `public/_headers`

**Could not open:** https://wank.wavu.wiki/ and https://wank.wavu.wiki/player/search?q=yoshimitsu&_format=json (WebFetch permission not granted in time; Bash egress refused by the proxy with a 403); https://wavu.wiki/t/Yoshimitsu (permission); https://dotesports.com/tekken/guides/tekken-8-patch-3-02-01-notes and https://games.gg/tekken-8/guides/tekken-8-ranked-mode-explained/ (site errors).
