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
  return ids.map(criterionLabel).join(', ');
}
