// Feature flags — spec Appendix A.3. 2.0 M2 removed matchImport: ranked
// games sync from Matches (src/services/rankedSync.ts), CSV stays on Import.
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
