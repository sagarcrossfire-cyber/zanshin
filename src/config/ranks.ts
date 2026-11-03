// Rank list and onboarding pickers — spec §10.3 and §5.2 / Appendix A.
import type { Profile } from '../data/schemas';
import { loadRankPack } from '../data/packs/ranks';

/** The 38 ranks for pickers, in ladder order (0 Beginner … 37 God of
 * Destruction ∞). 2.0 M2: read from the rank pack, the one source the
 * ranked importer also uses (1.4.1 had 37 and lacked plain "God of Destruction"). */
export const RANKS: string[] = loadRankPack().ladder.map((rung) => rung.name);

export const DEFAULT_TARGET_RANK = 'Tekken King';

/** Default glyph mode for each platform (§5.2: glyph mode is set from platform). */
export const PLATFORM_GLYPH: Record<Profile['platform'], Profile['glyphMode']> = {
  ps5: 'playstation',
  pc: 'numeric',
  xbox: 'xbox',
};

export const CONTROLLERS = ['DualSense', 'Xbox Elite', 'Arcade stick', 'Leverless', 'Other'] as const;

/**
 * Glyph mode implied by a controller choice (Oct 30 2026 correction: glyph mode
 * was set from platform only, so a PC player on an Xbox Elite saw numeric
 * glyphs). Picking a controller switches the glyphs; 'Other' has no entry, so
 * it leaves the current glyph mode untouched. The Button glyphs dropdown
 * still overrides this afterwards, in both onboarding and settings.
 */
export const CONTROLLER_GLYPH: Partial<Record<(typeof CONTROLLERS)[number], Profile['glyphMode']>> = {
  DualSense: 'playstation',
  'Xbox Elite': 'xbox',
  'Arcade stick': 'numeric',
  Leverless: 'numeric',
};

export const SESSION_MINUTES_OPTIONS = [20, 30, 45, 60] as const;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
