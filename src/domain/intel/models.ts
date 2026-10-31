// Release 1.3.0 — the models the intel function may call, shared by the
// server (netlify/functions/intel.mts via src/server/intel) and the app
// (Settings model picker, research client). Pure data, no I/O.

/** Models the function will call. Anything else is refused before it costs money. */
export const INTEL_MODELS = {
  'anthropic/claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', note: 'balanced, best coaching answers' },
  'anthropic/claude-haiku-5-5': { label: 'Claude Haiku 5.5', note: 'fastest and cheapest frontier model' },
  'openai/gpt-6-luna': { label: 'GPT-6 Luna', note: 'fast, cheap' },
  'google/gemini-3.8-flash': { label: 'Gemini 3.8 Flash', note: 'fast, cheap' },
  'perplexity/sonar': { label: 'Sonar', note: 'Perplexity’s grounded search model' },
} as const;
export type IntelModel = keyof typeof INTEL_MODELS;
export const DEFAULT_COACH_MODEL: IntelModel = 'anthropic/claude-haiku-5-5';
export const DEFAULT_RESEARCH_MODEL: IntelModel = 'perplexity/sonar';

export function isIntelModel(value: unknown): value is IntelModel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(INTEL_MODELS, value);
}

/** Model options for a select, in display order. */
export function intelModelOptions(): Array<{ value: IntelModel; label: string }> {
  return (Object.keys(INTEL_MODELS) as IntelModel[]).map((id) => ({
    label: `${INTEL_MODELS[id].label} — ${INTEL_MODELS[id].note}`,
    value: id,
  }));
}
