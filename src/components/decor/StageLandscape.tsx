/* 2.0 M6 — Path stage landscapes (design.md §D.2, §D.5): the Path reads as a
 * journey from foothills to summit. Each stage card carries an ink-wash strip
 * whose ridges rise with the stage, and a mark for where on the climb it is:
 * bamboo foothills → misty ridge → shrine approach → peaks in cloud → moon over
 * water. Original SVG, token-coloured, aria-hidden. A passed stage adds a seal
 * sun; the open stage tints its far ridge with the accent. */
import { ridgePath } from '../layout/HallArt';
import './StageLandscape.css';

export type StageScene = 'foothills' | 'mist' | 'shrine' | 'peaks' | 'moon';

/** Which part of the climb a stage (0-based, of `total`) belongs to. */
export function stageScene(index: number, total: number): StageScene {
  if (total > 1 && index >= total - 1) return 'moon';
  const scenes: StageScene[] = ['foothills', 'mist', 'shrine', 'peaks'];
  const span = Math.max(1, total - 1);
  return scenes[Math.min(scenes.length - 1, Math.floor((index / span) * scenes.length))]!;
}

/** Ridge heights grow with the stage: low foothills first, the high range last. */
export function stageRidges(index: number): Array<{ layer: 'far' | 'mid' | 'near'; d: string }> {
  const lift = Math.min(index, 9);
  return [
    { layer: 'far', d: ridgePath(101 + index * 3, 214, 30 + lift * 5, 6) },
    { layer: 'mid', d: ridgePath(102 + index * 3, 219, 20 + lift * 3.5, 5) },
    { layer: 'near', d: ridgePath(103 + index * 3, 224, 12 + lift * 2, 4) },
  ];
}

function SceneMark({ scene }: { scene: StageScene }) {
  switch (scene) {
    case 'foothills': // bamboo stalks at the foot of the climb
      return (
        <g className="z-stage-land__mark" transform="translate(960 140)">
          {[0, 22, 40].map((x, i) => (
            <g key={x} transform={`translate(${x} ${i * 8})`}>
              <rect width="6" height={90 - i * 8} />
              {[24, 52].map((y) => <rect key={y} x="-2" y={y} width="10" height="2" />)}
            </g>
          ))}
        </g>
      );
    case 'mist': // two bands of mist across the ridge
      return (
        <g className="z-stage-land__mist">
          <ellipse cx="820" cy="176" rx="360" ry="9" />
          <ellipse cx="1000" cy="196" rx="260" ry="7" />
        </g>
      );
    case 'shrine': // a small torii on the approach
      return (
        <g className="z-stage-land__mark" transform="translate(980 158) scale(0.45)">
          <path d="M-70 0 Q0 -14 70 0 L74 10 Q0 -2 -74 10 Z" />
          <rect x="-56" y="22" width="112" height="7" />
          <rect x="-48" y="8" width="9" height="104" />
          <rect x="39" y="8" width="9" height="104" />
        </g>
      );
    case 'peaks': // cloud wisps across the high peaks
      return (
        <g className="z-stage-land__mist">
          <rect x="760" y="150" width="220" height="10" rx="5" />
          <rect x="860" y="166" width="300" height="8" rx="4" />
          <rect x="700" y="182" width="160" height="7" rx="3.5" />
        </g>
      );
    case 'moon': // the moon over still water: the summit is a calm mind
      return (
        <g className="z-stage-land__mark" transform="translate(980 146)">
          <circle r="18" />
          <g className="z-stage-land__ripples" fill="none" strokeWidth="2.5" strokeLinecap="round">
            <path d="M-60 64 A60 8 0 0 1 -8 58" /><path d="M10 58 A60 8 0 0 1 64 66" />
          </g>
        </g>
      );
    default:
      return null;
  }
}

export function StageLandscape({ index, total, passed }: { index: number; total: number; passed: boolean }) {
  const scene = stageScene(index, total);
  return (
    <div className="z-stage-land" aria-hidden="true" data-scene={scene}>
      <svg viewBox="0 0 1200 220" preserveAspectRatio="xMaxYMax slice" focusable="false">
        {passed && <circle className="z-stage-land__sun" cx="860" cy="142" r="14" />}
        {scene === 'moon' && <SceneMark scene={scene} />}
        {stageRidges(index).map(({ layer, d }) => (
          <path key={layer} className={`z-stage-land__ridge z-stage-land__ridge--${layer}`} d={d} />
        ))}
        {scene !== 'moon' && <SceneMark scene={scene} />}
      </svg>
    </div>
  );
}
