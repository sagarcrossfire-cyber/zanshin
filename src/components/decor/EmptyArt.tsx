/* 2.0 M6 — illustrated empty states (design.md §D.2): a small original ink
 * drawing beside the "nothing here yet" line, so an empty screen still feels
 * made. Lantern (no matches), dojo floor (no sessions), washi (no cards),
 * raked gravel (no practice days), moon over water (no reviews). Token-coloured,
 * aria-hidden; the lantern sways and the moon's ripples drift, both still under
 * reduced motion. */
import type { ReactNode } from 'react';
import './EmptyArt.css';

export type EmptyScene = 'lantern' | 'dojo' | 'washi' | 'gravel' | 'moon';

function Drawing({ scene }: { scene: EmptyScene }) {
  switch (scene) {
    case 'lantern':
      return (
        <>
          <circle className="z-empty-art__glow" cx="80" cy="56" r="30" />
          <line className="z-empty-art__line" x1="80" y1="0" x2="80" y2="22" />
          <g className="z-empty-art__sway">
            <rect className="z-empty-art__ink" x="68" y="22" width="24" height="6" rx="2" />
            <ellipse className="z-empty-art__paper" cx="80" cy="54" rx="20" ry="26" />
            {[38, 46, 54, 62, 70].map((y) => (
              <path key={y} className="z-empty-art__line" d={`M${80 - Math.sqrt(1 - ((y - 54) / 26) ** 2) * 20} ${y} H${80 + Math.sqrt(1 - ((y - 54) / 26) ** 2) * 20}`} />
            ))}
            <rect className="z-empty-art__ink" x="70" y="79" width="20" height="5" rx="2" />
            <line className="z-empty-art__line" x1="80" y1="84" x2="80" y2="94" />
          </g>
        </>
      );
    case 'dojo':
      return (
        <>
          <rect className="z-empty-art__paper" x="30" y="10" width="100" height="44" rx="2" />
          {[55, 80, 105].map((x) => <line key={x} className="z-empty-art__line" x1={x} y1="10" x2={x} y2="54" />)}
          <line className="z-empty-art__line" x1="30" y1="32" x2="130" y2="32" />
          <path className="z-empty-art__ink" d="M8 96 L36 54 H124 L152 96 Z" />
          {[0.25, 0.5, 0.75].map((t) => (
            <line key={t} className="z-empty-art__floor" x1={36 + t * 88} y1="54" x2={8 + t * 144} y2="96" />
          ))}
        </>
      );
    case 'washi':
      return (
        <>
          <rect className="z-empty-art__paper z-empty-art__paper--back" x="44" y="18" width="64" height="76" rx="4" transform="rotate(-8 76 56)" />
          <rect className="z-empty-art__paper" x="50" y="12" width="64" height="76" rx="4" transform="rotate(4 82 50)" />
          <path className="z-empty-art__ink" transform="rotate(4 82 50)" d="M62 46 Q66 40 76 42 Q90 45 102 44 Q90 50 76 50 Q64 52 62 46 Z" />
        </>
      );
    case 'gravel':
      return (
        <>
          <ellipse className="z-empty-art__ink" cx="58" cy="60" rx="18" ry="11" />
          {[26, 36, 46].map((r) => (
            <ellipse key={r} className="z-empty-art__rake" cx="58" cy="62" rx={r + 8} ry={r * 0.55 + 4} />
          ))}
          {[74, 82, 90].map((y) => <path key={y} className="z-empty-art__rake" d={`M100 ${y} Q130 ${y - 3} 156 ${y}`} />)}
        </>
      );
    case 'moon':
      return (
        <>
          <circle className="z-empty-art__paper" cx="80" cy="34" r="20" />
          <g className="z-empty-art__ripples">
            <path className="z-empty-art__rake" d="M30 76 A50 7 0 0 1 72 70" />
            <path className="z-empty-art__rake" d="M88 70 A50 7 0 0 1 132 78" />
            <path className="z-empty-art__rake" d="M50 90 A40 6 0 0 1 112 90" />
          </g>
        </>
      );
    default:
      return null;
  }
}

export function EmptyArt({ scene }: { scene: EmptyScene }) {
  return (
    <svg className="z-empty-art" data-scene={scene} viewBox="0 0 160 100" aria-hidden="true" focusable="false">
      <Drawing scene={scene} />
    </svg>
  );
}

/** An empty-state line with its drawing: the text keeps its role and reading order. */
export function EmptyNote({ scene, children }: { scene: EmptyScene; children: ReactNode }) {
  return (
    <div className="z-empty">
      <EmptyArt scene={scene} />
      <div className="z-empty__text">{children}</div>
    </div>
  );
}
