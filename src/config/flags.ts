// Feature flags — spec Appendix A.3. All true. The broken 1.4.1
// matchImport flag (Wank/ewgf adapters) was retired in 2.0 M2: ranked sync
// (src/services/rankedSync.ts) replaces it; CSV import stays unflagged.
export const FLAGS = {
  baseline: true,
  coachAI: true,
  coachRules: true,
  codex: true,
  engine: true,
  flashcards: true,
  inAppImporter: true,
  lab: true,
  matchLog: true,
  patchWatch: true,
  punishTrainer: true,
  pwa: true,
} as const;

export type FlagName = keyof typeof FLAGS;
