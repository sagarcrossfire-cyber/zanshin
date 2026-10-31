// Spec §8.3 — context bundle for the AI coach. Markdown with headed sections,
// kept under ~6,000 tokens (estimated at 4 characters per token). Truncation
// drops the oldest session logs first and never cuts retrieved Codex entries.

export interface CoachCodexEntry {
  input: string;
  name?: string;
  aliases: string[];
  tags: string[];
  block?: string;
  hit?: string;
  provenance: { source: string; patch: string; status: string };
}

export interface CoachContextState {
  profile: {
    displayName?: string;
    platform?: string;
    currentStage?: number | string;
    targetRank?: string;
    sessionMinutes?: number;
    weeklyMinutes?: number;
  };
  currentStage: number | string;
  mastery: { nodeTitle: string; state: string; score: number; stageIndex: number | string }[];
  rustyNodes: { nodeTitle: string; score: number }[];
  sessions: {
    day: string;
    minutes: number;
    drills: { title: string; successRate: number; sets: number }[];
  }[];
  kpis: { label: string; value: string; sample: string }[];
  weaknesses: { label: string; severity: number; value: string; target: string }[];
  plan: {
    date: string;
    dayType: string;
    blocks: { kind: string; minutes: number; reason: string }[];
  } | null;
  codex: CoachCodexEntry[];
  dataStatus: { patch: string; openConflicts: number };
}

export const CONTEXT_TOKEN_LIMIT = 6000;
export const CONTEXT_CHARS_PER_TOKEN = 4;
export const MAX_CODEX_ENTRIES = 12;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CONTEXT_CHARS_PER_TOKEN);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'do', 'does',
  'did', 'my', 'me', 'i', 'to', 'for', 'against', 'with', 'and', 'or', 'of',
  'in', 'on', 'at', 'when', 'why', 'which', 'should', 'can', 'you', 'your',
  'this', 'that', 'it', 'its', 'be', 'as', 'by', 'from', 'about', 'into',
  'best', 'move', 'moves', 'use', 'using', 'get', 'go',
]);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function wordMatches(questionWords: string[], word: string): boolean {
  const lower = word.toLowerCase();
  return questionWords.some((w) => w === lower || w === `${lower}s` || lower === `${w}s`);
}

function questionWords(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/**
 * Keyword + alias retrieval (§8.3): no embeddings. Input/alias substring
 * matches score highest; name and tag word matches score lower. Max 12.
 */
export function retrieveCodexEntries(
  question: string,
  codex: CoachCodexEntry[],
  max: number = MAX_CODEX_ENTRIES,
): CoachCodexEntry[] {
  if (question.trim() === '') return [];
  const questionNorm = normalise(question);
  const words = questionWords(question);
  const scored = codex
    .map((entry) => {
      let score = 0;
      if (questionNorm.includes(normalise(entry.input))) score += 3;
      for (const alias of entry.aliases) {
        if (alias !== '' && questionNorm.includes(normalise(alias))) score += 2;
      }
      if (entry.name !== undefined) {
        const nameWords = entry.name.toLowerCase().split(/[^a-z0-9]+/);
        for (const word of nameWords) {
          if (word !== '' && wordMatches(words, word)) score += 1;
        }
      }
      for (const tag of entry.tags) {
        const tagWords = tag.toLowerCase().split(/[^a-z0-9]+/);
        if (tagWords.some((word) => word !== '' && wordMatches(words, word))) score += 1;
      }
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.entry.input < b.entry.input ? -1 : 1));
  return scored.slice(0, max).map((item) => item.entry);
}

function codexLine(entry: CoachCodexEntry): string {
  const parts = [`- ${entry.input}`];
  if (entry.name !== undefined && entry.name !== '') parts.push(`(${entry.name})`);
  if (entry.block !== undefined && entry.block !== '') parts.push(`Block: ${entry.block}.`);
  if (entry.hit !== undefined && entry.hit !== '') parts.push(`Hit: ${entry.hit}.`);
  parts.push(
    `Source: ${entry.provenance.source}, patch ${entry.provenance.patch}, ${entry.provenance.status}.`,
  );
  return parts.join(' ');
}

interface BundleParts {
  sessions: CoachContextState['sessions'];
  planSummary: boolean;
  kpiSummary: boolean;
  masterySummary: boolean;
}

function buildBundle(state: CoachContextState, parts: BundleParts): string {
  const lines: string[] = ['# ZANSHIN coach context', '', '## Profile'];
  const profile = state.profile;
  lines.push(`- Player: ${profile.displayName ?? 'Sagar'}.`);
  if (profile.platform !== undefined) lines.push(`- Platform: ${profile.platform}.`);
  lines.push(`- Current stage: ${state.currentStage}.`);
  if (profile.targetRank !== undefined) lines.push(`- Target rank: ${profile.targetRank}.`);
  if (profile.sessionMinutes !== undefined) lines.push(`- Session budget: ${profile.sessionMinutes} minutes.`);
  if (profile.weeklyMinutes !== undefined) lines.push(`- Weekly budget: ${profile.weeklyMinutes} minutes.`);

  lines.push('', '## Mastery');
  if (parts.masterySummary) {
    lines.push(`- ${state.mastery.length} nodes tracked; ${state.rustyNodes.length} rusty.`);
  } else {
    const current = state.mastery.filter((node) => node.stageIndex === state.currentStage);
    const shown = current.length > 0 ? current : state.mastery;
    for (const node of shown) {
      lines.push(`- ${node.nodeTitle}: ${node.state} (${node.score.toFixed(2)}).`);
    }
    if (current.length === 0 && state.mastery.length > 0) {
      lines.push('- (No nodes in the current stage; showing all tracked nodes.)');
    }
  }

  lines.push('', '## Rusty nodes');
  if (state.rustyNodes.length === 0) {
    lines.push('- None.');
  } else {
    for (const node of state.rustyNodes) {
      lines.push(`- ${node.nodeTitle} (${node.score.toFixed(2)}).`);
    }
  }

  lines.push('', '## Last 14 days');
  if (parts.sessions.length === 0) {
    lines.push('- No sessions logged.');
  } else {
    for (const session of parts.sessions) {
      const drills = session.drills
        .map((drill) => `${drill.title} ${Math.round(drill.successRate * 100)}% over ${drill.sets} sets`)
        .join('; ');
      lines.push(
        `- ${session.day}: ${session.minutes} minutes${drills === '' ? '.' : `. ${drills}.`}`,
      );
    }
  }

  lines.push('', '## KPIs (last 10–20 games)');
  if (parts.kpiSummary) {
    lines.push(`- ${state.kpis.length} KPIs tracked.`);
  } else if (state.kpis.length === 0) {
    lines.push('- No games logged yet.');
  } else {
    for (const kpi of state.kpis) {
      lines.push(`- ${kpi.label}: ${kpi.value} (${kpi.sample}).`);
    }
  }

  lines.push('', '## Weaknesses');
  if (state.weaknesses.length === 0) {
    lines.push('- None detected.');
  } else {
    for (const weakness of state.weaknesses) {
      lines.push(
        `- ${weakness.label}: ${weakness.value} vs target ${weakness.target} (severity ${Math.round(weakness.severity * 100)}%).`,
      );
    }
  }

  lines.push('', "## Today's plan");
  if (state.plan === null) {
    lines.push('- No plan.');
  } else if (parts.planSummary) {
    lines.push(`- ${state.plan.date} (${state.plan.dayType}): ${state.plan.blocks.length} blocks.`);
  } else {
    lines.push(`- ${state.plan.date} (${state.plan.dayType}):`);
    for (const block of state.plan.blocks) {
      lines.push(`  - ${block.kind}, ${block.minutes} min: ${block.reason}`);
    }
  }

  lines.push('', '## Codex entries');
  // Codex entries are never truncated; retrieval already caps at 12.
  lines.push('- None matched the question.');
  lines.push('', '## Data status');
  lines.push(`- Patch: ${state.dataStatus.patch}. Open conflicts: ${state.dataStatus.openConflicts}.`);
  return lines.join('\n');
}

export function buildContext(question: string, state: CoachContextState): string {
  const entries = retrieveCodexEntries(question, state.codex);
  const parts: BundleParts = {
    sessions: state.sessions,
    planSummary: false,
    kpiSummary: false,
    masterySummary: false,
  };
  // Insert the Codex section by rebuilding with entries spliced in: build once,
  // then replace the placeholder line so truncation never touches the entries.
  const render = (current: BundleParts): string => {
    const bundle = buildBundle(state, current);
    const codexLines = entries.map(codexLine);
    const replacement =
      entries.length === 0 ? '- None matched the question.' : codexLines.join('\n');
    return bundle.replace('- None matched the question.', replacement);
  };

  let bundle = render(parts);
  // Truncate the oldest session logs first.
  while (estimateTokens(bundle) > CONTEXT_TOKEN_LIMIT && parts.sessions.length > 0) {
    parts.sessions = parts.sessions.slice(1);
    bundle = render(parts);
  }
  if (estimateTokens(bundle) > CONTEXT_TOKEN_LIMIT) {
    parts.planSummary = true;
    bundle = render(parts);
  }
  if (estimateTokens(bundle) > CONTEXT_TOKEN_LIMIT) {
    parts.kpiSummary = true;
    bundle = render(parts);
  }
  if (estimateTokens(bundle) > CONTEXT_TOKEN_LIMIT) {
    parts.masterySummary = true;
    bundle = render(parts);
  }
  // If still over the limit, the bundle keeps the Codex entries whole (spec:
  // never cut Codex entries) and the caller accepts the overflow.
  return bundle;
}
