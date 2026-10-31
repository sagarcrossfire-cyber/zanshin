/* StanceMap — spec §4.7. Static SVG graph: 1SS center; NSS, KIN, DGF, FLE, IND,
 * MED, BT, BDS, WFL around it. Solid edges = manual entries (labelled with the input
 * text); dashed edges = move transitions. Nodes are Tab-reachable buttons;
 * arrow keys move between nodes; Enter/Space calls onSelect(stanceId).
 * No character art — nodes are labelled circles with stance codes as text. */
import { useRef } from 'react';
import './StanceMap.css';

export type StanceId = '1SS' | 'NSS' | 'KIN' | 'DGF' | 'FLE' | 'IND' | 'MED' | 'BT' | 'BDS' | 'WFL';
export interface StanceEdge { from: StanceId; to: StanceId; label: string; kind: 'manual' | 'move'; }
export interface StanceMapProps {
  selected?: StanceId | null;
  onSelect?: (stance: StanceId) => void;
  edges?: StanceEdge[];
}

// Positions in a 0..100 viewBox. Center + 9 around. WFL sits upper-right;
// its entry is unknown in the pack (D-022), so it has no edge.
const POS: Record<StanceId, { x: number; y: number }> = {
  '1SS': { x: 50, y: 50 }, NSS: { x: 50, y: 12 }, DGF: { x: 78, y: 22 }, FLE: { x: 88, y: 50 },
  BT: { x: 78, y: 78 }, BDS: { x: 50, y: 88 }, MED: { x: 22, y: 78 }, IND: { x: 12, y: 50 }, KIN: { x: 22, y: 22 },
  WFL: { x: 92, y: 30 },
};
const ORDER: StanceId[] = ['1SS', 'NSS', 'KIN', 'DGF', 'FLE', 'IND', 'MED', 'BT', 'BDS', 'WFL'];
// Default edges use only real entry/move inputs from the stance pack
// (AC-STANCE-2). WFL has no recorded entry, so it has no edge.
const DEFAULT_EDGES: StanceEdge[] = [
  { from: '1SS', to: 'NSS', label: 'b+1+2', kind: 'manual' },
  { from: '1SS', to: 'KIN', label: '1+2', kind: 'manual' },
  { from: '1SS', to: 'DGF', label: 'u+1+2', kind: 'manual' },
  { from: '1SS', to: 'FLE', label: 'd+1+2', kind: 'manual' },
  { from: '1SS', to: 'IND', label: 'd+3+4', kind: 'manual' },
  { from: '1SS', to: 'MED', label: '3+4', kind: 'manual' },
  { from: '1SS', to: 'BDS', label: 'db+1+2', kind: 'manual' },
  { from: '1SS', to: 'BT', label: 'f,F+4', kind: 'move' },
];

export function StanceMap({ selected = null, onSelect, edges = DEFAULT_EDGES }: StanceMapProps) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusNode = (idx: number) => btnRefs.current[(idx + ORDER.length) % ORDER.length]?.focus();
  return (
    <div className="z-stance-map" role="group" aria-label="Stance map. Use Tab to reach a stance, arrow keys to move between stances, Enter to open it.">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {edges.map((e, i) => {
          const a = POS[e.from]; const b = POS[e.to];
          const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
          return (
            <g key={i}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-strong)" strokeWidth={0.7} strokeDasharray={e.kind === 'move' ? '1.6 1.2' : undefined} />
              <text x={mx} y={my - 1.5} textAnchor="middle" className="z-stance-map__edge-label">{e.label}</text>
            </g>
          );
        })}
      </svg>
      {ORDER.map((id, i) => (
        <button
          key={id} ref={(el) => { btnRefs.current[i] = el; }} type="button"
          className={`z-stance-map__node${id === '1SS' ? ' z-stance-map__node--center' : ''}`}
          style={{ left: `${POS[id].x}%`, top: `${POS[id].y}%` }}
          aria-pressed={selected === id}
          aria-label={`Stance ${id}${selected === id ? ', selected' : ''}`}
          onClick={() => onSelect?.(id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusNode(i + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusNode(i - 1); }
          }}
        >{id}</button>
      ))}
    </div>
  );
}
