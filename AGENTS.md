# AGENTS.md — rules for AI agents working on ZANSHIN

ZANSHIN is a private, local-first Tekken 8 Yoshimitsu coaching PWA. Read README.md for the full picture.

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

Required CI checks on the PR: **Types, lint, unit tests, build** and **Browser tests (phone and desktop)**.
