/* FrameLegend — release 1.4.0. The key to every number on a move: what
 * startup, on block and on hit mean, the punish tiers, the letters after a
 * value, bracketed second values, hit levels, provenance badges and stance
 * abbreviations. Written from the definitions the app already ships (spec
 * §4.7: SUFFIX_TIPS, HitLevelChips, frameTier); nothing here is invented.
 * Rendered with live samples of the same components the move list uses. */
import { loadStances } from '../../data/packs';
import { useAppStore } from '../../stores/appStore';
import { InputString } from '../signature/InputString';
import { DataBadge } from '../base/DataBadge';
import { FrameValue, SUFFIX_TIPS } from '../signature/FrameValue';
import { HitLevelChips } from '../signature/HitLevelChips';
import './FrameLegend.css';

const TIERS: Array<{ value: string; label: string; range: string; meaning: string }> = [
  { value: '+2', label: 'Plus', range: '+1 or better', meaning: 'Your turn: you recover first and can keep attacking.' },
  { value: '-5', label: 'Safe', range: '0 to −9', meaning: 'You are behind, but too little for a jab (i10) to punish.' },
  { value: '-12', label: 'Punishable', range: '−10 to −14', meaning: 'Blocking it gives the opponent a free punish of that speed.' },
  { value: '-16', label: 'Launch punishable', range: '−15 or worse', meaning: 'Blocking it gives the opponent a launcher and a full combo.' },
];

const HIT_LEVELS: Array<{ token: string; meaning: string }> = [
  { token: 'h', meaning: 'High — duck under it, or block standing.' },
  { token: 'm', meaning: 'Mid — block standing; ducking gets hit.' },
  { token: 'l', meaning: 'Low — block crouching, or jump/low-parry.' },
  { token: 'sm', meaning: 'Special mid — can be blocked standing or crouching.' },
  { token: 'T', meaning: 'Throw — break it with the matching button.' },
  { token: '!', meaning: 'Unblockable — move or interrupt, never block.' },
];

/** Tekken notation as Wavu Wiki writes it, rendered with your button glyphs. */
const NOTATION: Array<{ input: string; meaning: string }> = [
  { input: '1', meaning: 'Left punch. 2 is right punch, 3 left kick, 4 right kick.' },
  { input: 'd/f+1', meaning: 'Direction plus button. Directions are f, b, u, d and diagonals like d/f.' },
  { input: '1+2', meaning: '+ means press together.' },
  { input: '1,2', meaning: ', means one after the other (a string).' },
  { input: 'f,F+2', meaning: 'Lower-case direction is a tap; capital means hold it.' },
  { input: '1~2', meaning: '~ means immediately after.' },
  { input: 'NSS.2', meaning: 'A stance name and a dot: do it from that stance (see Stances).' },
];

const MOVE_BADGES: Array<{ label: string; tone: string; meaning: string }> = [
  { label: 'Launcher', tone: 'launch', meaning: 'Lifts them into the air on hit: start a combo.' },
  { label: 'Heat Engager', tone: 'heat', meaning: 'On hit, puts you into Heat.' },
  { label: 'Homing', tone: 'default', meaning: 'Catches a sidestep in either direction.' },
  { label: 'Power crush', tone: 'default', meaning: 'Keeps going through their attacks while you take the damage.' },
];

export function FrameLegend({ compact = false }: { compact?: boolean }) {
  const stances = loadStances();
  const glyphMode = useAppStore((state) => state.profile?.glyphMode) ?? 'playstation';
  return (
    <div className={`z-legend${compact ? ' z-legend--compact' : ''}`} data-testid="frame-legend">
      <section className="z-legend__block" aria-labelledby="legend-startup">
        <h3 id="legend-startup" className="z-legend__title"><span className="z-legend__sample z-data">i13</span> Startup</h3>
        <p>Frames until the move can hit. Lower is faster: <span className="z-data">i10</span> is jab speed. A range such as <span className="z-data">i17~18</span> depends on spacing. One frame is 1/60 s.</p>
      </section>

      <section className="z-legend__block" aria-labelledby="legend-hit">
        <h3 id="legend-hit" className="z-legend__title"><span className="z-legend__sample"><FrameValue value="+4" /></span> On hit</h3>
        <p>Frame advantage after it hits. Plus on hit means your next move comes first. <strong>CH</strong> is the value on a counter hit (hitting them while they attack).</p>
      </section>

      <section className="z-legend__block" aria-labelledby="legend-paren">
        <h3 id="legend-paren" className="z-legend__title"><span className="z-legend__sample"><FrameValue value="+16a (+7)" showTierIcon={false} /></span> Bracketed value</h3>
        <p>Some moves have a second published value for a different situation. The app always rates the move by the first number; the move’s page and its Wavu notes say when the bracketed one applies.</p>
      </section>

      <section className="z-legend__block z-legend__block--wide" aria-labelledby="legend-block">
        <h3 id="legend-block" className="z-legend__title"><span className="z-legend__sample"><FrameValue value="-9" /></span> On block</h3>
        <p>Frame advantage after the opponent blocks it. Minus means you recover later than they do. The colour, the icon and the stripe on each row tell you how risky it is:</p>
        <ol className="z-legend__tiers">
          {TIERS.map((tier) => (
            <li key={tier.label} className="z-legend__tier">
              <FrameValue value={tier.value} />
              <span className="z-legend__tier-text"><strong>{tier.label}</strong> <span className="z-data-s">{tier.range}</span><br />{tier.meaning}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="z-legend__block" aria-labelledby="legend-letters">
        <h3 id="legend-letters" className="z-legend__title"><span className="z-legend__sample"><FrameValue value="+16a" showTierIcon={false} /></span> Letters after a value</h3>
        <dl className="z-legend__defs">
          {Object.entries(SUFFIX_TIPS).map(([letter, tip]) => (
            <div key={letter}><dt className="z-data">{letter}</dt><dd>{tip}</dd></div>
          ))}
        </dl>
      </section>

      <section className="z-legend__block" aria-labelledby="legend-levels">
        <h3 id="legend-levels" className="z-legend__title">Hit level</h3>
        <dl className="z-legend__defs z-legend__defs--levels">
          {HIT_LEVELS.map((level) => (
            <div key={level.token}><dt><HitLevelChips levels={level.token} /></dt><dd>{level.meaning}</dd></div>
          ))}
          <div><dt className="z-legend__pair"><HitLevelChips levels="m" /><HitLevelChips levels="M" /></dt><dd>A bar under the letter: the hit also connects on an opponent lying on the ground.</dd></div>
        </dl>
        <p className="z-caption">Strings list one level per hit: <HitLevelChips levels="h,h,m" /> is high, high, mid.</p>
      </section>

      <section className="z-legend__block" aria-labelledby="legend-status">
        <h3 id="legend-status" className="z-legend__title">How sure the number is</h3>
        <dl className="z-legend__defs z-legend__defs--status">
          <div><dt><DataBadge status="verified" /></dt><dd>You checked it in Practice mode.</dd></div>
          <div><dt><DataBadge status="sourced" /></dt><dd>From Wavu Wiki or the seed pack.</dd></div>
          <div><dt><DataBadge status="unverified" /></dt><dd>Published by Wavu Wiki, not yet checked by you. Most moves are; the move list leaves them unmarked.</dd></div>
          <div><dt><DataBadge status="conflicting" /></dt><dd>Sources disagree; open the move to compare.</dd></div>
          <div><dt><DataBadge status="web" /></dt><dd>Prose from web research. Never frame data.</dd></div>
        </dl>
      </section>

      <section className="z-legend__block z-legend__block--wide" aria-labelledby="legend-notation">
        <h3 id="legend-notation" className="z-legend__title">Reading an input</h3>
        <dl className="z-legend__defs z-legend__defs--notation">
          {NOTATION.map((row) => (
            <div key={row.input}><dt><InputString input={row.input} glyphMode={glyphMode} size="small" /></dt><dd>{row.meaning}</dd></div>
          ))}
        </dl>
        <p className="z-caption">Buttons show as your controller’s glyphs (Settings → Button glyphs).</p>
      </section>

      <section className="z-legend__block" aria-labelledby="legend-badges">
        <h3 id="legend-badges" className="z-legend__title">Move badges</h3>
        <dl className="z-legend__defs z-legend__defs--status">
          {MOVE_BADGES.map((badge) => (
            <div key={badge.label}><dt><span className={`z-chip z-chip--${badge.tone}`}>{badge.label}</span></dt><dd>{badge.meaning}</dd></div>
          ))}
        </dl>
      </section>

      <section className="z-legend__block z-legend__block--wide2" aria-labelledby="legend-stances">
        <h3 id="legend-stances" className="z-legend__title">Stances and positions</h3>
        <dl className="z-legend__defs z-legend__defs--stances">
          {stances.map((stance) => (
            <div key={stance.id}><dt className="z-data">{stance.id}</dt><dd>{stance.name === stance.id ? 'Wavu’s abbreviation; full name not in the stance pack' : stance.name}</dd></div>
          ))}
          <div><dt className="z-data">FC</dt><dd>Full crouch</dd></div>
          <div><dt className="z-data">WS</dt><dd>While standing (rising from a crouch)</dd></div>
          <div><dt className="z-data">SS</dt><dd>Sidestep</dd></div>
        </dl>
      </section>
    </div>
  );
}
