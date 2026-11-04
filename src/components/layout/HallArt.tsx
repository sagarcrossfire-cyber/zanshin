/* 2.0 M6 — the hub "hall" behind every screen header (design.md §D.5):
 * three ink-wash ridge layers drawn from a seed (so each hub has its own
 * skyline), a small hub motif, and the hub's kanji as a faint watermark.
 * Original SVG, token-coloured, aria-hidden. The ridges drift at different
 * rates as the page scrolls (one shared rAF listener writes --hall-scroll);
 * reduced motion stops the drift, reduced transparency hides the art.
 * Behind the ridges, when "Show art" is on, a grayscale photo of the hub's
 * place (Unsplash, credited in Settings › Images and clips) tinted by the
 * scene glow: AVIF with a WebP fallback, 800 px wide, 1600 px on desktops. */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { HUBS, childFor, hubFor, sectionFor, type HubId } from '../../app/hubs';
import artCredits from '../../data/art-credits.json';
import { useMediaPrefs } from '../../services/mediaLibrary';
import './HallArt.css';

export interface HallPhotoCredit {
  hub: string;
  /** A section (or Codex child) with its own photo, e.g. 'heat', 'punish'; absent for the hub's own. */
  section?: string;
  id: string;
  photographer: string;
  handle: string;
  page: string;
  position: string;
  formats: string[];
  license: string;
}

export const HALL_PHOTOS: readonly HallPhotoCredit[] = (artCredits as { halls: HallPhotoCredit[] }).halls;

/** The file stem the pack wrote: the section for a section hall, else the hub. */
function stem(credit: HallPhotoCredit): string {
  return credit.section ?? credit.hub;
}

/** The CSS image for one width: image-set() of the formats the pack wrote, best first. */
export function hallPhotoImage(credit: HallPhotoCredit, width: 800 | 1600): string {
  const order = ['avif', 'webp'].filter((f) => credit.formats.includes(f));
  return `image-set(${order.map((f) => `url("/art/${stem(credit)}-${width}.${f}") type("image/${f}")`).join(', ')})`;
}

/** Plain url() of the most compatible format, for engines without image-set(type()). */
export function hallPhotoFallback(credit: HallPhotoCredit, width: 800 | 1600): string {
  const f = credit.formats.includes('webp') ? 'webp' : credit.formats[0];
  return `url("/art/${stem(credit)}-${width}.${f}")`;
}

/** The photo for a hall: the section's own when it has one, else the hub's. */
export function hallPhotoFor(hub: string, section?: string | null): HallPhotoCredit | undefined {
  return (section ? HALL_PHOTOS.find((c) => c.section === section) : undefined)
    ?? HALL_PHOTOS.find((c) => c.hub === hub && !c.section);
}

/** "Study · Heat" for a section hall, "Study" for a hub's: the Credits list's names. */
export function hallLabel(credit: HallPhotoCredit): string {
  const hub = HUBS.find((h) => h.id === credit.hub);
  if (!hub) return credit.hub;
  if (!credit.section) return hub.label;
  const all = hub.sections.flatMap((s) => [s, ...(s.children ?? [])]);
  return `${hub.label} · ${all.find((s) => s.id === credit.section)?.label ?? credit.section}`;
}

function HallPhoto({ hub, section }: { hub: HubId; section?: string | null }) {
  const prefs = useMediaPrefs();
  const credit = hallPhotoFor(hub, section);
  if (!prefs.showArt || !credit) return null;
  const style = {
    '--hall-photo-fallback-sm': hallPhotoFallback(credit, 800),
    '--hall-photo-sm': hallPhotoImage(credit, 800),
    '--hall-photo-fallback-lg': hallPhotoFallback(credit, 1600),
    '--hall-photo-lg': hallPhotoImage(credit, 1600),
    backgroundPosition: credit.position,
  } as CSSProperties;
  return <div className="z-hall__photo" data-photo={credit.id} style={style} />;
}

const W = 1200;
const H = 220;

/** Mulberry32: a tiny seeded PRNG so a hub's skyline is the same every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ridge silhouette: smooth peaks across the width, closed along the bottom. */
export function ridgePath(seed: number, baseline: number, amplitude: number, peaks: number): string {
  const rand = rng(seed);
  const step = W / peaks;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= peaks; i += 1) {
    const x = i * step + (i > 0 && i < peaks ? (rand() - 0.5) * step * 0.5 : 0);
    const y = baseline - amplitude * (0.35 + rand() * 0.65);
    pts.push([Math.round(x), Math.round(y)]);
  }
  let d = `M0 ${H} L0 ${pts[0]![1]}`;
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1]!;
    const [x1, y1] = pts[i]!;
    const mx = Math.round((x0 + x1) / 2);
    d += ` Q${x0 + Math.round((mx - x0) / 2)} ${Math.min(y0, y1) - Math.round(amplitude * 0.25)} ${mx} ${Math.round((y0 + y1) / 2)} T${x1} ${y1}`;
  }
  return `${d} L${W} ${H} Z`;
}

const SEEDS: Record<HubId, number> = { today: 11, train: 23, coach: 37, study: 41, you: 53 };

function Motif({ hub }: { hub: HubId }) {
  switch (hub) {
    case 'today': // torii: two pillars, kasagi and nuki
      return (
        <g className="z-hall__motif" transform="translate(960 70)">
          <path d="M-70 0 Q0 -14 70 0 L74 10 Q0 -2 -74 10 Z" />
          <rect x="-56" y="22" width="112" height="7" />
          <rect x="-48" y="8" width="9" height="104" />
          <rect x="39" y="8" width="9" height="104" />
        </g>
      );
    case 'train': // bamboo stalks with node rings
      return (
        <g className="z-hall__motif" transform="translate(930 0)">
          {[0, 34, 62, 101].map((x, i) => (
            <g key={x} transform={`translate(${x} ${i * 9})`}>
              <rect x="0" y="0" width="9" height={220 - i * 9} />
              {[48, 104, 160].map((y) => <rect key={y} x="-2" y={y} width="13" height="3" />)}
            </g>
          ))}
        </g>
      );
    case 'coach': // moon and broken ripples ("the moon in water")
      return (
        <g className="z-hall__motif" transform="translate(990 74)">
          <circle r="34" />
          <g fill="none" strokeWidth="3" strokeLinecap="round" className="z-hall__ripples">
            <path d="M-80 104 A80 12 0 0 1 -12 96" /><path d="M14 96 A80 12 0 0 1 84 106" />
            <path d="M-50 120 A60 9 0 0 1 46 122" />
          </g>
        </g>
      );
    case 'study': // three straight brush strokes, heavy at the start and tapering out (not arcs: arcs read as a Wi-Fi icon)
      return (
        <g className="z-hall__motif" transform="translate(900 40) rotate(-4)">
          {([[0, 0, 150], [22, 40, 104], [6, 82, 176]] as const).map(([x, y, len]) => (
            <path key={y} transform={`translate(${x} ${y})`}
              d={`M0 9 Q4 0 18 2 Q${len * 0.55} 7 ${len} 10 Q${len * 0.55} 14 18 19 Q3 20 0 9 Z`} />
          ))}
        </g>
      );
    case 'you': // hanko seal
      return (
        <g className="z-hall__motif" transform="translate(1000 60)">
          <rect x="-36" y="-36" width="72" height="72" rx="8" fill="none" strokeWidth="6" />
          <path d="M-18 -16 H18 M0 -16 V22 M-16 4 H16" fill="none" strokeWidth="6" strokeLinecap="square" />
        </g>
      );
    default:
      return null;
  }
}

// One passive scroll listener for every hall on the page; writes --hall-scroll (px) on <html>.
let listeners = 0;
let frame = 0;
function onScroll(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    document.documentElement.style.setProperty('--hall-scroll', String(Math.min(window.scrollY, 600)));
  });
}

function useHallScroll(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    listeners += 1;
    if (listeners === 1) {
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    return () => {
      listeners -= 1;
      if (listeners === 0) {
        window.removeEventListener('scroll', onScroll);
        document.documentElement.style.removeProperty('--hall-scroll');
      }
    };
  }, []);
}

export function HallArt({ hub, kanji, section }: { hub: HubId; kanji: string; section?: string | null }) {
  useHallScroll();
  const seed = SEEDS[hub];
  return (
    <div className="z-hall__art" aria-hidden="true" data-hall={hub} data-section={section ?? undefined}>
      <HallPhoto hub={hub} section={section} />
      <span className="z-hall__kanji" lang="ja">{kanji}</span>
      <svg className="z-hall__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMax slice" focusable="false">
        <Motif hub={hub} />
        <path className="z-hall__ridge z-hall__ridge--far" d={ridgePath(seed, 205, 72, 7)} />
        <path className="z-hall__ridge z-hall__ridge--mid" d={ridgePath(seed + 1, 214, 52, 6)} />
        <path className="z-hall__ridge z-hall__ridge--near" d={ridgePath(seed + 2, 222, 34, 5)} />
      </svg>
    </div>
  );
}

/** For any screen header: the hall class and art for the current route's hub
 * (none outside a hub). PageHeader uses it; screens with their own header
 * (Matchups, Moves, Path) add `hallClass` to it and render `hallArt` first. */
export function useHubHall(): { hallClass: string; hallArt: ReactNode } {
  const { pathname } = useLocation();
  const hub = hubFor(pathname);
  if (!hub) return { hallClass: '', hallArt: null };
  const section = childFor(pathname)?.id ?? sectionFor(pathname)?.id ?? null;
  return { hallClass: 'z-hall', hallArt: <HallArt hub={hub.id} kanji={hub.kanji} section={section} /> };
}
