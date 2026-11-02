/* ZANSHIN icons — spec §4.6. Original 24px-grid, 1.75px-stroke SVGs, round
 * joins, no fills except state dots. Generic icons are hand-drawn here;
 * lucide-react is NOT imported (zero extra deps). Every icon is aria-hidden;
 * meaning comes from the parent's visible label / aria-label. */
import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------- Navigation (§4.6) ---------- */
/* 2.0 hub icons (design.md §C.6): a makiwara striking post, a scroll, a
 * summit with a flag. */
export const IconTrain = (p: IconProps) => (<Svg {...p}><path d="M12 3v18" /><rect x="8.5" y="5.5" width="7" height="8" rx="1.5" /><path d="M8 21h8" /></Svg>);
export const IconStudy = (p: IconProps) => (<Svg {...p}><path d="M6.5 4.5H17a2 2 0 0 1 0 4H8.5" /><path d="M6.5 4.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H17" /><path d="M8.5 8.5v11" /><path d="M11.5 12h5M11.5 15h3.5" /></Svg>);
export const IconYou = (p: IconProps) => (<Svg {...p}><path d="M3 19.5 9.5 9l4 6 2.5-3.5 5 8z" /><path d="M15 7.5V3.5l3.5 1.4L15 6.2" /></Svg>);
export const IconSidebar = (p: IconProps) => (<Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 4.5v15" /></Svg>);
export const IconPlus = (p: IconProps) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>);
export const IconToday = (p: IconProps) => (<Svg {...p}><path d="M4 19a8 8 0 0 1 16 0" /><path d="M12 11V6" /><path d="M8 19h8" /></Svg>);
export const IconPath = (p: IconProps) => (<Svg {...p}><circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="5" r="1.6" /><path d="M6.5 17.5 10.5 13.5M13.5 10.5 17.5 6.5" strokeDasharray="2 2.5" /></Svg>);
export const IconLab = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 1.5" /><path d="M9.5 2.5h5" /><path d="M12 2.5V6" /></Svg>);
export const IconCodex = (p: IconProps) => (<Svg {...p}><path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z" /><path d="M5 17.5h13" /><path d="M9 8.5h6M9 11.5h4" /></Svg>);
export const IconPunish = (p: IconProps) => (<Svg {...p}><path d="M12 3.5 5.5 6v5c0 4.5 2.8 7.6 6.5 9.5 3.7-1.9 6.5-5 6.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></Svg>);
export const IconMatchups = (p: IconProps) => (<Svg {...p}><path d="M9 5 4 12l5 7" /><path d="M15 5l5 7-5 7" /></Svg>);
export const IconLog = (p: IconProps) => (<Svg {...p}><path d="M5 4h14v16H5z" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></Svg>);
export const IconProgress = (p: IconProps) => (<Svg {...p}><path d="M4 20h4v-5h4V9h4V4h4" /><path d="M4 20h16" /></Svg>);
export const IconCoach = (p: IconProps) => (<Svg {...p}><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-5 4z" /><path d="M8 9h8M8 12h5" /></Svg>);
export const IconCards = (p: IconProps) => (<Svg {...p}><rect x="7" y="4" width="13" height="16" rx="2" /><path d="M4 8v11a2 2 0 0 0 2 2h11" /><path d="M11 9h5M11 12.5h5" /></Svg>);
export const IconPatch = (p: IconProps) => (<Svg {...p}><path d="M4 19a8 8 0 0 1 16 0" /><path d="M12 12.5 15.5 6" /><circle cx="12" cy="12.5" r="1.4" fill="currentColor" stroke="none" /></Svg>);
export const IconSettings = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.7M12 18.5v2.7M2.8 12h2.7M18.5 12h2.7M5.5 5.5l1.9 1.9M16.6 16.6l1.9 1.9M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9" /></Svg>);

/* ---------- Stances (§4.6) ---------- */
export const IconStance1SS = (p: IconProps) => (<Svg {...p}><path d="M12 4v16" /><path d="M8 20h8" /></Svg>);
export const IconStanceNSS = (p: IconProps) => (<Svg {...p}><path d="M12 4v6M12 13v7" /><path d="M8 20h8" /></Svg>);
export const IconStanceDGF = (p: IconProps) => (<Svg {...p}><path d="M4 17a8 8 0 0 1 16 0" /><path d="M8.5 12.5 12 9l3.5 3.5" /></Svg>);
export const IconStanceKIN = (p: IconProps) => (<Svg {...p}><rect x="8" y="7" width="8" height="8" /><path d="M5 18.5h14" /></Svg>);
export const IconStanceFLE = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="8" r="3" /><path d="M8 17h8" /></Svg>);
export const IconStanceIND = (p: IconProps) => (<Svg {...p}><path d="M12 6.5 17 16H7z" /><path d="M5 19h14" /></Svg>);
export const IconStanceMED = (p: IconProps) => (<Svg {...p}><path d="M4 13a8 8 0 0 1 16 0" /><path d="M8 13h8" /></Svg>);
export const IconStanceBT = (p: IconProps) => (<Svg {...p}><path d="M5 9a7 7 0 0 1 12-2.5" /><path d="M17 3.5v3h-3" /><path d="M12 9v5M9.5 16.5h5" /></Svg>);
export const IconStanceBDS = (p: IconProps) => (<Svg {...p}><path d="M3 8c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0" /><path d="M3 13c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0" /><path d="M3 18c2.5-2.5 5-2.5 7.5 0s5 2.5 7.5 0" /></Svg>);
export const stanceIconMap: Record<string, (p: IconProps) => ReactNode> = {
  '1SS': IconStance1SS, NSS: IconStanceNSS, DGF: IconStanceDGF, KIN: IconStanceKIN,
  FLE: IconStanceFLE, IND: IconStanceIND, MED: IconStanceMED, BT: IconStanceBT, BDS: IconStanceBDS,
};

/* ---------- Move properties (§4.6) ---------- */
export const IconHeat = (p: IconProps) => (<Svg {...p}><path d="M12 3.5c1 3-2.5 5-2.5 8a4.5 4.5 0 0 0 9 0c0-2-1-3.5-2-5-.5 1.2-1.5 2-2.5 2 1-1.8.5-3.5-2-5z" /><path d="M10 19.5h4" /></Svg>);
export const IconHoming = (p: IconProps) => (<Svg {...p}><path d="M4 18a9 9 0 0 0 14-8" /><path d="M18 5.5v4.5h-4.5" /></Svg>);
export const IconPowerCrush = (p: IconProps) => (<Svg {...p}><path d="M12 3.5 5.5 6v5c0 4.5 2.8 7.6 6.5 9.5 3.7-1.9 6.5-5 6.5-9.5V6z" /><path d="M4 12h5M15 12h5" /></Svg>);
export const IconLauncher = (p: IconProps) => (<Svg {...p}><path d="M12 20V7" /><path d="M7.5 11.5 12 7l4.5 4.5" /><path d="M5 20h14" /></Svg>);
export const IconTornado = (p: IconProps) => (<Svg {...p}><path d="M12 12a2 2 0 0 1 2 2 4 4 0 0 1-4 4 6.5 6.5 0 0 1-6.5-6.5A9 9 0 0 1 12.5 3" /></Svg>);
export const IconWallSplat = (p: IconProps) => (<Svg {...p}><path d="M18 3.5v17" /><path d="M18 8l-6 4 6 4" /><path d="M4 12h6" /></Svg>);
export const IconWallBreak = (p: IconProps) => (<Svg {...p}><path d="M5 4v16M19 4v16" /><path d="M5 8l4 4-4 4M19 8l-4 4 4 4" /></Svg>);
export const IconFloorBreak = (p: IconProps) => (<Svg {...p}><path d="M3 18h18" /><path d="M8 18l3-5 2 3 3-6" /></Svg>);
export const IconBalconyBreak = (p: IconProps) => (<Svg {...p}><path d="M3 18h6v-5h6V8h6" /><path d="M3 18h18" /></Svg>);
export const IconUnblockable = (p: IconProps) => (<Svg {...p}><path d="M8 3.5h8l4.5 4.5v8L16 20.5H8L3.5 16V8z" /><path d="M12 8v5" /><circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" /></Svg>);
export const IconHpCost = (p: IconProps) => (<Svg {...p}><path d="M12 20s-7-4.6-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.4 12 20 12 20z" /><path d="M9.5 12h5" /></Svg>);
export const IconParry = (p: IconProps) => (<Svg {...p}><path d="M4 17a8 8 0 0 1 13-6" /><path d="M17 5.5v4h-4" /><path d="M6 20.5h12" /></Svg>);
export const IconLowCrush = (p: IconProps) => (<Svg {...p}><path d="M4 18h16" /><path d="M12 14V5" /><path d="M8.5 8.5 12 5l3.5 3.5" /></Svg>);
export const IconHighCrush = (p: IconProps) => (<Svg {...p}><path d="M4 6h16" /><path d="M12 10v9" /><path d="M8.5 15.5 12 19l3.5-3.5" /></Svg>);

/* ---------- Frame tiers (§4.6) ---------- */
export const IconTierPlus = (p: IconProps) => (<Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8.5v7M8.5 12h7" /></Svg>);
export const IconTierSafe = (p: IconProps) => (<Svg {...p}><path d="M5 12h14" /></Svg>);
export const IconTierPunish = (p: IconProps) => (<Svg {...p}><path d="M6 8l6 6 6-6" /></Svg>);
export const IconTierLaunch = (p: IconProps) => (<Svg {...p}><path d="M6 6.5 12 12.5 18 6.5" /><path d="M6 13.5 12 19.5 18 13.5" /></Svg>);

/* ---------- Data badges (§4.6) ---------- */
export const IconVerified = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2 11 14.7 15.7 9.8" /></Svg>);
export const IconSourced = (p: IconProps) => (<Svg {...p}><path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v15H6.5A1.5 1.5 0 0 0 5 20.5z" /><path d="M5 19.5V5.5" /><path d="M9 8h6M9 11.5h4" /></Svg>);
export const IconConflicting = (p: IconProps) => (<Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>);
/** Web-sourced prose (release 1.3.0): a globe. */
export const IconWeb = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.6 3.6 5.4 3.6 8.5s-1 5.9-3.6 8.5c-2.6-2.6-3.6-5.4-3.6-8.5s1-5.9 3.6-8.5z" /></Svg>);
export const IconUnverified = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4A2.6 2.6 0 0 1 12 7.6c1.4 0 2.5 1 2.5 2.2 0 1.7-2.2 1.9-2.5 3.4" /><circle cx="12" cy="16.4" r="0.6" fill="currentColor" stroke="none" /></Svg>);

/* ---------- Generic (hand-drawn) ---------- */
export const IconSearch = (p: IconProps) => (<Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></Svg>);
export const IconChevronDown = (p: IconProps) => (<Svg {...p}><path d="M6 9.5 12 15.5 18 9.5" /></Svg>);
export const IconChevronLeft = (p: IconProps) => (<Svg {...p}><path d="M14.5 6 8.5 12l6 6" /></Svg>);
export const IconChevronRight = (p: IconProps) => (<Svg {...p}><path d="M9.5 6l6 6-6 6" /></Svg>);
export const IconClose = (p: IconProps) => (<Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>);
export const IconCheck = (p: IconProps) => (<Svg {...p}><path d="M5 12.5 10 17.5 19 7" /></Svg>);
export const IconCopy = (p: IconProps) => (<Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Svg>);
export const IconClock = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>);
export const IconLock = (p: IconProps) => (<Svg {...p}><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></Svg>);
export const IconWarning = (p: IconProps) => (<Svg {...p}><path d="M12 4 21 19.5H3z" /><path d="M12 10v4" /><circle cx="12" cy="16.8" r="0.6" fill="currentColor" stroke="none" /></Svg>);
export const IconFlame = IconHeat;
export const IconDot = (p: IconProps) => (<Svg {...p}><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></Svg>);
