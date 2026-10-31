// §6.7 — Derived move tags: importer rules merged with the curated §10 lists. Pure.
import type { MoveTag } from '../schemas';
import { isLauncherValue } from './parse';

/** Inputs that enter a stance directly (§10.5 entries). */
export const STANCE_ENTRY_INPUTS: ReadonlySet<string> = new Set([
  'b+1+2', '1+2', 'u+1+2', 'd+1+2', 'd+3+4', '3+4', 'db+1+2',
]);

/** Heat Engagers from §10.8 (Wavu list plus TekkenDocs' NSS variants). */
export const HEAT_ENGAGER_INPUTS: ReadonlySet<string> = new Set([
  '3,1', 'f+1+2', 'b+2,2', 'KIN.f+2', 'DGF.4', '3,NSS.1', 'b+2,NSS.2', 'NSS.f+1+2',
]);

/** Homing moves from §10.13 (sidestep-to-his-right answers). */
export const HOMING_INPUTS: ReadonlySet<string> = new Set([
  'f+3', 'uf+4', 'DGF.f+2', 'DGF.f+1+2', 'IND.3+4', 'KIN.4', 'KIN.f+2', 'hFC.df+4', '1+3', '2+4',
]);

/** Tornado combo filler (§10.6 Role for d+2,2,2). */
export const TORNADO_INPUTS: ReadonlySet<string> = new Set(['d+2,2,2']);

/** Wall-splat moves: CD2 and ws1,2 carry the wall-splat Role in §10.6/§10.12. */
export const WALL_SPLAT_INPUTS: ReadonlySet<string> = new Set(['f,n,d,df+2', 'ws1,2']);

/** Wall-break ender (§10.6 Role for 3,2,1+2; Heat Smash breaks walls, §10.8). */
export const WALL_BREAK_INPUTS: ReadonlySet<string> = new Set(['3,2,1+2', 'H.2+3']);

/** Floor-break ender (§10.6 Role for d+1). */
export const FLOOR_BREAK_INPUTS: ReadonlySet<string> = new Set(['d+1']);

/** Balcony-break: Heat Smash breaks balconies (§10.8). */
export const BALCONY_BREAK_INPUTS: ReadonlySet<string> = new Set(['H.2+3']);

/** Moves that cost Yoshimitsu's own health (§10.9/§10.11 seppuku and spin). */
export const HP_COST_INPUTS: ReadonlySet<string> = new Set(['b+3', 'b+4', 'f,F+1+4', 'd+1+4']);

/** Power-crush moves whose crush field is not published in §10 (Role curation, §10.6). */
export const POWER_CRUSH_INPUTS: ReadonlySet<string> = new Set(['R.df+1+2']);

/** Panic tools (§10.9): Flash and the Manji Spin, in every stance that has Flash. */
export const PANIC_INPUTS: ReadonlySet<string> = new Set([
  '1+4', 'b+3', 'b+4', 'KIN.1+4', 'MED.1+4', 'NSS.1+4',
]);

/** Keepout tools (§10.9 table, minus the panic rows). */
export const KEEPOUT_INPUTS: ReadonlySet<string> = new Set([
  'uf+3', 'f,n,d,df+2', 'df+2', 'df+4', '3~4', 'f+1+2', 'BDS.1',
]);

/** Whiff punishers (§10.6 Roles and the d2-whiff drill, §11.2). */
export const WHIFF_PUNISHER_INPUTS: ReadonlySet<string> = new Set(['b+2,2', '3,1', 'df+2']);

/** Okizeme tools (§10.11): ground hits, tech-roll punishes and oki unblockables. */
export const OKI_INPUTS: ReadonlySet<string> = new Set([
  'FC.DF+1', 'd+1', 'db+4', 'BDS.1', 'db+1+2,1+2', 'KIN.b+1+2', 'MED.1+2', 'IND.1', 'DGF.3+4',
]);

export interface TagInput {
  id: string;
  input: string;
  hitLevel: string;
  crush?: string;
  blockMin?: number;
  hit?: string;
  counterHit?: string;
  notes?: string;
}

export interface PunisherTagContext {
  standingInputs: ReadonlySet<string>;
  crouchingInputs: ReadonlySet<string>;
}

function hitLevels(hitLevel: string): string[] {
  return hitLevel.split(',').map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * Derives tags from Wavu fields per §6.7, merged with the curated §10 lists
 * and with words in the notes. Order follows the §6.7 table; duplicates are
 * removed. Pure.
 */
export function deriveTags(move: TagInput, punisherContext?: PunisherTagContext): MoveTag[] {
  const tags: MoveTag[] = [];
  const add = (tag: MoveTag): void => {
    if (!tags.includes(tag)) tags.push(tag);
  };
  const levels = hitLevels(move.hitLevel);
  const crush = move.crush ?? '';
  const notes = (move.notes ?? '').toLowerCase();

  if (levels.some((level) => level.includes('!'))) add('unblockable');
  if (levels.includes('t')) add('throw');
  if (/\bpc\d/.test(crush) || crush.includes('pc') || POWER_CRUSH_INPUTS.has(move.input)) add('power-crush');
  if (/\bps\d/.test(crush) || crush.includes('ps')) add('parry');
  if (/\bjs\d/.test(crush) || crush.includes('js')) add('low-crush');
  if (/\bcs\d/.test(crush) || crush.includes('cs')) add('high-crush');
  if (move.blockMin !== undefined && move.blockMin >= 1) add('plus-on-block');
  if (isLauncherValue(move.hit)) add('launcher');
  if (isLauncherValue(move.counterHit) && !isLauncherValue(move.hit)) add('ch-launcher');
  if (move.id.startsWith('Yoshimitsu-H.')) add('heat-only');
  if (move.input === 'H.2+3') add('heat-smash');
  if (move.input === '2+3') add('heat-burst');
  if (move.input.startsWith('R.')) add('rage-art');
  if (STANCE_ENTRY_INPUTS.has(move.input)) add('stance-entry');

  // Curated lists (§10) and notes wording (§6.7: notes containing those words add the tag).
  if (HEAT_ENGAGER_INPUTS.has(move.input) || notes.includes('heat engager')) add('heat-engager');
  if (HOMING_INPUTS.has(move.input) || notes.includes('homing')) add('homing');
  if (TORNADO_INPUTS.has(move.input) || notes.includes('tornado')) add('tornado');
  if (WALL_SPLAT_INPUTS.has(move.input)) add('wall-splat');
  if (WALL_BREAK_INPUTS.has(move.input) || notes.includes('wall break')) add('wall-break');
  if (FLOOR_BREAK_INPUTS.has(move.input) || notes.includes('floor break')) add('floor-break');
  if (BALCONY_BREAK_INPUTS.has(move.input) || notes.includes('balcony break')) add('balcony-break');
  if (
    HP_COST_INPUTS.has(move.input)
    || notes.includes('self-damage')
    || notes.includes('costs his own health')
    || notes.includes('costs yoshimitsu')
  ) add('hp-cost');
  if (PANIC_INPUTS.has(move.input)) add('panic');
  if (KEEPOUT_INPUTS.has(move.input)) add('keepout');
  if (WHIFF_PUNISHER_INPUTS.has(move.input)) add('whiff-punisher');
  if (OKI_INPUTS.has(move.input)) add('oki');

  if (punisherContext !== undefined) {
    if (punisherContext.standingInputs.has(move.input)) add('punisher-standing');
    if (punisherContext.crouchingInputs.has(move.input)) add('punisher-crouching');
  }
  return tags;
}

/** Merges derived tags with a curated list, deduplicated, derived order first. Pure. */
export function mergeTags(derived: MoveTag[], curated: MoveTag[]): MoveTag[] {
  const merged: MoveTag[] = [...derived];
  for (const tag of curated) {
    if (!merged.includes(tag)) merged.push(tag);
  }
  return merged;
}
