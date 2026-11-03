# AGENTS.md — rules for AI agents working on ZANSHIN

ZANSHIN is a private, local-first Tekken 8 Yoshimitsu coaching PWA. Read README.md for the full picture.

## Read these first (every task)
Hermes loads this file instead of `CLAUDE.md`, so everything a worker must know is linked here.
1. `docs/REFERENCE.md` — the core concept (never drift from it), the codebase rules, where things live,
   the release path, environment limits, and §7: the **root-cause protocol** and the **failure catalog**
   (check the catalog before debugging — most failures have happened before).
2. `docs/v2/PLAN.md` — the current 2.0 plan: milestones, acceptance criteria and the gate every change
   must pass (arrives on `main` with 2.0 M1). Your card names the milestone; build to its criteria.
3. `docs/ops/INVENTORY.md` — the map of what already exists. Reuse before you add.
4. `docs/ops/RCA_LOG.md` — past failures. If you fix a failure, add a row (date · symptom · root cause ·
   fix · guard) in the same PR.

Also:
- **Never bump the version** in `package.json` or `APP_VERSION` unless your card is a release card: a version
  change makes CI deploy to production, and each production deploy costs 15 of Netlify's 300 monthly credits.
- New screens or routes get an entry in `src/app/hubs.ts` and a row in `tests/unit/nav/hubs.spec.ts` (2.0 M1).
- Run `npm run doctor` before opening a PR; it prints the fix for anything inconsistent.
- Keep scratch files out of the repo. Worker copies live in `.worktrees/`, which git, ESLint and Vitest ignore.
- On a failure: capture the evidence, reproduce it with the narrowest command, find the root cause, fix it and
  add a guard (test, lint rule or doctor check). Never retry blindly or raise a timeout without a reason.

## Stack
React 18 · TypeScript (strict) · Vite · Zustand · Dexie (IndexedDB) · Zod · Vitest · Playwright · axe. Node version: see `.nvmrc`.

## Hard rules (enforced by lint/tests — do not work around them)
- Only repositories touch IndexedDB. Screens never call `fetch`.
- No colour literals outside `src/styles/tokens.css`.
- Domain code is pure and stays at 90%+ coverage.
- Every scheme passes WCAG AA; no image may be cropped.
- Web-sourced text is a research note with a *Web-sourced* badge — never written into frame data.
- Never weaken, skip or delete a test to make CI pass.

## Never
- Push to `main` (it is protected; changes go through a PR with passing checks).
- Commit `public/media/`, `public/icons/`, `.zanshin-media-cache/` or any secret.
- Add, read or print API keys (Netlify, Perplexity, GitHub). Secrets live in Netlify / GitHub settings only.
- Deploy from a laptop. Deploys happen only via CI after merge.

## Workflow for every task
1. Work only inside the git worktree and branch your task names.
2. `npm ci`, then make the change with tests.
3. Run `npm run verify:quick` (typecheck + lint + unit tests). Run `npm run test:e2e` when you touched UI.
4. Commit with a clear message, push the branch, open a PR: `gh pr create --base main --fill`.
5. Finish the card with `kanban_complete`, passing `metadata.published_pr` = the PR URL, plus
   `changed_files`, `verification` (commands you ran) and `residual_risk`.
6. If you are stuck or the card is ambiguous, use `kanban_block` with a specific question.
7. If a shared script, config or test that is NOT in your card's file list is broken (it fails on bare `origin/main` too), do not fix it in your PR — parallel workers will fix it differently and the PRs will conflict. `kanban_block` with the exact error and the command that reproduces it; the lead fixes it on `main` once.

Required CI checks on the PR: **Types, lint, unit tests, build** and **Browser tests (phone and desktop)**.
