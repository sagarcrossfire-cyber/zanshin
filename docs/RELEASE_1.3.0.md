# ZANSHIN 1.3.0 — Intelligence

Base: 1.2.0 (`1e808f4`). Schema v4 → v5 (one new table, `research`).

## What changed for Sagar

- **The coach can run on a frontier model without a key on the phone.** Settings → Coach has a new provider, *ZANSHIN intelligence (this site, key on the server)*. The site's own function talks to Perplexity's Agent API with the key kept in Netlify; the browser only ever calls its own origin. Pick the model there: Claude Haiku 5.5 (default, fastest and cheapest), Claude Sonnet 5.5, GPT-6 Luna, Gemini 3.8 Flash or Sonar. Same system prompt, same CONTEXT block, same checker and single "Next action:" line as before. *Test connection* is free (it reads the function's health, not a model).
- **Look it up.** A fourth Coach tab. Ask a Tekken question; the site searches trusted Tekken sites only (Wavu Wiki, TekkenDocs, tekken.com, Bandai Namco, EventHubs, DashFight, Tekken Zaibatsu, Reddit, YouTube) and answers in at most 180 words with numbered sources. If the question names a roster character, Sagar's record against them and his logged problem moves ride along as context. The answer wears the new **Web-sourced** badge (globe, dashed) with the model and date; sources are links; any frame number in the text gets a warning that it came from the web and must be verified in the Codex. *Keep as a note* stores it; kept notes list under the form and delete from there.
- **Matchup primer.** Every character page has a *Matchup primer* card: their plan, what to punish, what to duck or step, Yoshimitsu's answers, what to watch for, with sources. The site generates it once and caches it for 30 days; the device keeps a copy as a research note, so the second visit costs nothing and works offline. *Refresh primer* forces a new one.
- **Explain this update.** After a Wavu update is applied, Patch Watch offers a brief: one bullet per changed move (what changed in practice, what to do), a closing line on what to re-verify in Practice, sources. Cached by revision on the site and kept on the device.
- **Spend is capped and visible.** The function refuses paid calls once the day's reported cost reaches `INTEL_DAILY_CAP_USD` (default $3; set on the Netlify site) and says so in plain words; it resets at midnight UTC. Settings shows today's spend and the last seven days; every answer shows what it cost; Diagnostics has a *Check intelligence function* button.
- **Web text never becomes frame data.** Research is prose with citations in its own table. Nothing in it is written to a move, a punisher, a conflict or any verified field; the prompts tell the model to write frame numbers as "reported", and the app flags them regardless.

## Design

- `netlify/functions/intel.mts` → `src/server/intel/handler.ts`: routes `GET health`, `GET usage`, `POST coach`, `POST research`, `GET primer/:name` (`?refresh=1`), `POST patch-brief`. Zod validates every body; unknown models are refused before anything is spent. Usage per day (`usage/<day>`) and the caches (`primer/<name>`, `patch/<revision>`) live in Netlify Blobs with strong consistency. A stale primer is served if regeneration fails. Perplexity's cost field is what the cap counts.
- `src/server/intel/perplexity.ts`: one call shape — `instructions` + `input` (+ `web_search` tool for research, primers and briefs, `search_type: 'fast'`, six results, domain filter), parsed into text, search results and usage. 9 s timeout, because Netlify's synchronous functions stop at ~10 s; the app says "took too long, try again or pick a faster model".
- `src/domain/intel/models.ts` is the one list of models both sides import. `src/services/intel.ts` is the browser client (errors carry the server's words and the HTTP status; 429 = cap, 503 = no key). `src/services/research.ts` builds the context, checks the text (`checkResearch`: sanitize, list frame-like numbers — a `+2` inside `f,f+2` is a button, not a frame value) and writes research notes.
- `src/domain/coach/providers/zanshin.ts`: the fourth `CoachProvider`. `providerFromSettings` returns it with no key check; `testConnection` uses `/health` for it.
- `research` table (schema v5): `id, kind, subjectKey, createdAt`; rows `{kind: 'answer' | 'primer' | 'patch', subjectKey?, question, text, citations[], model, costUsd?, revision?, createdAt}`. In `BACKUP_TABLES`, `TABLE_ADAPTERS` and the diagnostics row schemas; one primer or brief per subject, replaced on refresh.
- `DataBadge` gained `'web'` ("Web-sourced", globe icon, `--info` with a dashed border so it reads apart from *Sourced* without colour).
- `src/components/research/ResearchNoteView.tsx` renders every note the same way (badge, checked Markdown through the existing safe renderer, frame warning, sources, actions); `renderSafeMarkdown` moved from the Coach screen to `src/components/coach/markdown.tsx` so components can use it.
- Found on the way: `takePreMigrationSnapshot` read every `BACKUP_TABLES` table from the *old* database, so the first backed-up table added by a new schema version would have made the pre-migration snapshot fail (the upgrade still ran, but without its safety net). It now records a table the old schema lacks as empty.

## Decisions

| Id | Decision | Why |
| --- | --- | --- |
| D-130-1 | The Perplexity key lives in a Netlify Function, not in the app's settings | The site is private but a key in IndexedDB is a key in every browser that opens it; on the server it is one environment variable, and a cap can sit in front of it |
| D-130-2 | Perplexity's Agent API for every call, with frontier models for coaching and Sonar for research | One key, one request shape, model choice in Settings; the Agent API reports cost per call, which the cap needs |
| D-130-3 | Daily spend cap in Blobs, counted from Perplexity's reported cost | A looping client or a shared link cannot drain the prepaid balance by more than the cap in a day |
| D-130-4 | Primers and briefs are generated at runtime and cached on the site, not built in CI | The agent cannot add GitHub secrets, and a 30-day cache makes the first visit the only paid one |
| D-130-5 | Research is its own table with a `web` badge; it never touches frame data | The verification model from 1.0.0 stays intact: verified means Wavu-verified, never "a website said" |
| D-130-6 | A 9 s server timeout and plain "too slow" messaging rather than edge functions or streaming | Free-plan synchronous functions stop at 10 s; Haiku and Sonar answer in 2–5 s; edge functions are the next step if the limit bites |
| D-130-7 | Trusted-site allowlist for web search | Frame-data forums and clickbait would otherwise feed the model; the list is one constant to edit |

## Tests

- Unit: `tests/unit/server/intel.spec.ts` (11: routing, validation, the cap, caching, stale fallback, error mapping, transcript flattening, response parsing), `tests/unit/research/research.spec.ts` (16: domain helpers, the client, the provider, the service writing notes, backup round-trip), `tests/unit/research/migrate-v5.spec.ts` (2). 844 unit tests in all.
- End to end: `tests/e2e/intel.spec.ts` (6 × phone and desktop) with `page.route` answering `/.netlify/functions/intel/**`: Settings provider and spend meter, Ask through the site with the chosen model in the request, Look it up with sources, badge, frame warning and Keep, the cap and missing-key messages, the primer cached on the device and refreshed, Diagnostics and axe.

## Setting it up

The Netlify site needs `PERPLEXITY_API_KEY` (set) and optionally `INTEL_DAILY_CAP_USD` (set to 3). After the deploy, `/.netlify/functions/intel/health` should answer `"keyConfigured": true`. Then Settings → Coach → *ZANSHIN intelligence*, Save, *Test connection*.

## For later

- Semantic Codex search with the Embeddings API (precomputed in CI, no runtime cost).
- Screenshot match logging with the Decisions API (an experiment; the match log form stays).
- Warming every primer in CI needs a GitHub secret for the key, which only the repository owner can add.
- Edge functions (no 10 s limit) if Sonnet-class answers start timing out.
