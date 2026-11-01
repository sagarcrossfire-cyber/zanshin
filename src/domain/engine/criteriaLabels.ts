// Release 1.4.0 — plain-words names for gate criterion ids, so the Path
// shows "80% of nodes solid" instead of "solidShare". Pure data.
const LABELS: Record<string, string> = {
  solidShare: '80% of nodes solid',
  drillSuccess: 'drill success',
  heatWasteRate: 'Heat wasted',
  hitWhileMinusPerGame: 'hit while minus',
  lowBlockRate: 'lows blocked',
  missedPunishesPerGame: 'missed punishes',
  okiPerGame: 'oki converted',
  panicSuccessRate: 'panic-tool success',
  punishQuizAccuracy: 'punish quiz accuracy',
  throwBreakRate: 'throw breaks',
  verifiedShare: 'moves verified',
};

export function criterionLabel(id: string): string {
  return LABELS[id] ?? id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

export function criteriaText(ids: string[]): string {
  return [...new Set(ids.map(criterionLabel))].join(', ');
}

const ANSWER_KIND_LABELS: Record<string, string> = {
  punish: 'Punish', 'block-high': 'Block high', 'block-low': 'Block low', duck: 'Duck',
  'sidestep-left': 'Sidestep left', 'sidestep-right': 'Sidestep right', backdash: 'Backdash',
  interrupt: 'Interrupt', parry: 'Parry', flash: 'Flash',
};

/** "sidestep-left" → "Sidestep left" for problem-move answers. */
export function answerKindLabel(kind: string): string {
  return ANSWER_KIND_LABELS[kind] ?? kind.replace(/-/g, ' ');
}

/** Plan reasons come from the engine in its own words ("mastery 0.42,
 * never practiced"); this turns the numbers into what a player reads. */
export function plainReason(reason: string): string {
  return reason
    .replace(/mastery (\d+(?:\.\d+)?)/g, (_m, value: string) => {
      const pct = Math.round(Number(value) * 100);
      return pct === 0 ? 'new' : `mastery ${pct}%`;
    })
    .replace(/never practiced/g, 'not practised yet')
    .replace(/practiced/g, 'practised');
}
