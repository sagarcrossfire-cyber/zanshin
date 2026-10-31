// Feature flags — spec Appendix A.3. All true except matchImport
// (false until P7 turns it on; baseline turned on in P8).
export const FLAGS = {
  baseline: true,
  coachAI: true,
  coachRules: true,
  codex: true,
  engine: true,
  flashcards: true,
  inAppImporter: true,
  lab: true,
  matchImport: false,
  matchLog: true,
  patchWatch: true,
  punishTrainer: true,
  pwa: true,
} as const;

export type FlagName = keyof typeof FLAGS;
