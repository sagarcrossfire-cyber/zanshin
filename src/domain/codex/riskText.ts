// Risk text and opponent answers — spec §5.6 (P4 prompt step 2). Frame
// values become sentences using only the pack's own numbers; nothing here
// invents data. Block tiers follow §10.2 (−10 punishable, −15 launch).
import { blockOf, firstInt } from './filters';
import type { Move } from '../../data/schemas';

/** "−13 on block: punishable by any i13 punisher." / "−20: launch punishable." / "+7: you keep your turn at +7." */
export function riskSentences(move: Move): string[] {
  const sentences: string[] = [];
  const block = blockOf(move);
  if (block !== null && move.block !== undefined) {
    const shown = move.block.replace(/-/g, '−');
    if (block <= -15) {
      sentences.push(`${shown} on block: launch punishable.`);
    } else if (block <= -10) {
      sentences.push(`${shown} on block: punishable by any i${Math.abs(block)} punisher.`);
    } else if (block > 0) {
      sentences.push(`${shown} on block: you keep your turn at +${block}.`);
    } else if (block === 0) {
      sentences.push('Even on block: neither side keeps the turn.');
    } else {
      sentences.push(`${shown} on block: safe — the opponent cannot punish it.`);
    }
  }
  if (move.tags.includes('hp-cost')) {
    sentences.push('Costs Yoshimitsu’s own health.');
  }
  if (move.tags.includes('unblockable')) {
    sentences.push('Unblockable: it cannot be blocked, only avoided or interrupted.');
  }
  if (move.tags.includes('throw')) {
    sentences.push('A throw: break it by following the hands (1, 2, or 1+2).');
  }
  return sentences;
}

/** Opponent's answer, derived from the pack's hit level, block tier and tags — labelled as derived, never invented frame data. */
export function opponentAnswers(move: Move): string[] {
  const answers: string[] = [];
  const levels = move.hitLevel.toLowerCase();
  if (levels.includes('h')) {
    answers.push('Duck the high hit.');
  }
  if (move.tags.includes('homing')) {
    answers.push('Sidestepping will not work — it tracks.');
  } else if (move.tags.includes('unblockable')) {
    answers.push('Sidestep or interrupt — it cannot be blocked.');
  }
  const block = blockOf(move);
  if (block !== null && block <= -15) {
    answers.push('Punish with a launcher.');
  } else if (block !== null && block <= -10) {
    answers.push(`Punish with any i${Math.abs(block)} punisher.`);
  }
  if (move.tags.includes('parry')) {
    answers.push('Throws and unblockables beat a parry stance.');
  }
  return answers;
}

/** Split the merged notes field into Wavu note bullets and the curated Role text ("| Role: …" appended at merge, D-008). */
export function splitNotes(move: Move): { bullets: string[]; role: string | null } {
  const notes = move.notes ?? '';
  const marker = ' | Role: ';
  const markerAt = notes.indexOf(marker);
  const role = markerAt >= 0 ? notes.slice(markerAt + marker.length).trim() : null;
  const raw = markerAt >= 0 ? notes.slice(0, markerAt) : notes;
  const bullets = raw
    .split('*')
    .map((part) => part.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '' && part !== '|');
  return { bullets, role };
}

/** Parse a recovery string ("r34 1SS") into frames + stance, for the FrameBar. Null when unparseable. */
export function parseFrameParts(move: Move): { startup: number; active: number; recovery: number } | null {
  const startup = firstInt(move.startup);
  const total = firstInt(move.total);
  const recovery = move.recovery ? firstInt(move.recovery.replace(/^r/i, '')) : null;
  if (startup === null || total === null || recovery === null) return null;
  const active = total - startup - recovery;
  if (active < 0) return null;
  return { startup, active, recovery };
}

export function wavuMoveUrl(moveId: string): string {
  return `https://wavu.wiki/t/Yoshimitsu_movelist#${encodeURIComponent(moveId)}`;
}
