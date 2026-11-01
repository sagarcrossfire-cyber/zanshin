/* Ornaments — release 1.4.0 ("Ink and steel"). Original SVG drawn for
 * ZANSHIN: a brush ensō, a brush stroke, a katana divider and a hanko seal.
 * All decorative (aria-hidden) and coloured by tokens through currentColor
 * or CSS classes; no game logos or emblems are reproduced. */
import './Ornaments.css';

/** A brush ensō, open at one o'clock. Strokes vary in width like a brush. */
export function BrushEnso({ className = '', size = 240 }: { className?: string; size?: number }) {
  return (
    <svg className={`z-orn-enso ${className}`} width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <path d="M150 38 C 118 14 60 18 34 60 C 12 96 22 148 64 170 C 104 192 160 176 178 132 C 190 102 182 72 164 52"
        fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" opacity="0.9" />
      <path d="M146 44 C 116 24 66 28 42 64 C 22 98 32 144 70 162"
        fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
      <path d="M174 118 C 168 142 150 160 124 168" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/** A single horizontal brush stroke, tapered at both ends. */
export function BrushStroke({ className = '' }: { className?: string }) {
  return (
    <svg className={`z-orn-stroke ${className}`} viewBox="0 0 320 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M2 14 C 40 6 90 4 150 8 C 210 12 270 6 318 10 C 270 18 210 20 150 18 C 90 16 40 20 2 14 Z" fill="currentColor" />
    </svg>
  );
}

/** A katana laid flat: a section divider. */
export function KatanaDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`z-orn-katana ${className}`} aria-hidden="true">
      <span className="z-orn-katana__line" />
      <svg viewBox="0 0 120 16" width="120" height="16" focusable="false">
        <path d="M2 8 L 70 6.5 Q 96 6 118 3 Q 100 10 70 9.5 L 2 9 Z" fill="currentColor" opacity="0.9" />
        <rect x="64" y="3" width="3" height="10" rx="1" fill="currentColor" />
      </svg>
      <span className="z-orn-katana__line" />
    </div>
  );
}

/** A hanko seal bearing 残 (zan): the ZANSHIN mark. */
export function Hanko({ className = '', size = 36 }: { className?: string; size?: number }) {
  return (
    <span className={`z-orn-hanko ${className}`} style={{ width: size, height: size, fontSize: size * 0.62 }} aria-hidden="true">残</span>
  );
}

/** Drifting embers for scene backgrounds (static under reduced motion). */
export function Embers({ count = 14 }: { count?: number }) {
  return (
    <div className="z-orn-embers" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 1.7) % 11}s`, animationDuration: `${11 + (i % 5) * 2}s` }} />
      ))}
    </div>
  );
}
