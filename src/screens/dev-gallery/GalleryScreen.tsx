/* Dev gallery — spec §4.7 (gallery at /dev/gallery, every state), §5.1.
 * Exported for the coordinator to wire as the /dev/gallery route (development
 * builds only). Theme + glyph switchers live in the gallery itself; the gallery
 * wrapper carries data-theme so both themes render without touching the app.
 * Sample notations/values are taken from the spec text only — no pack data is
 * invented here. InputString renders through the notation engine
 * (src/domain/notation/*), which landed during this build. */
import { useState } from 'react';
import { Button } from '../../components/base/Button';
import { IconButton } from '../../components/base/IconButton';
import { Card } from '../../components/base/Card';
import { Chip } from '../../components/base/Chip';
import { Tabs } from '../../components/base/Tabs';
import { Stepper } from '../../components/base/Stepper';
import { Toggle } from '../../components/base/Toggle';
import { Select } from '../../components/base/Select';
import { TextField } from '../../components/base/TextField';
import { Sheet } from '../../components/base/Sheet';
import { Modal } from '../../components/base/Modal';
import { Toast, type ToastItem } from '../../components/base/Toast';
import { EmptyState } from '../../components/base/EmptyState';
import { ErrorState } from '../../components/base/ErrorState';
import { Skeleton } from '../../components/base/Skeleton';
import { ProgressLine } from '../../components/base/ProgressLine';
import { StatTile } from '../../components/base/StatTile';
import { DataBadge } from '../../components/base/DataBadge';
import { InputString, type GlyphMode } from '../../components/signature/InputString';
import { FrameValue } from '../../components/signature/FrameValue';
import { HitLevelChips } from '../../components/signature/HitLevelChips';
import { FrameBar } from '../../components/signature/FrameBar';
import { PunishLadder } from '../../components/signature/PunishLadder';
import { StanceMap, type StanceId } from '../../components/signature/StanceMap';
import { EnsoRing } from '../../components/signature/EnsoRing';
import { HeatGauge } from '../../components/signature/HeatGauge';
import { RepLogger } from '../../components/signature/RepLogger';
import { DrillCard } from '../../components/signature/DrillCard';
import { MatchupCard } from '../../components/signature/MatchupCard';
import { CoachMessage } from '../../components/signature/CoachMessage';
import { PatchBanner } from '../../components/signature/PatchBanner';
import * as Icons from '../../components/icons';
import { IconClose, IconSearch } from '../../components/icons';
import './GalleryScreen.css';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="z-gallery__section" aria-label={title}><h2 className="z-title">{title}</h2><div className="z-gallery__row">{children}</div></section>;
}

const NOTATIONS = ['f,n,d,df+2', 'H.2+3', 'KIN.f+1+2', 'FC.DF+1', 'ub+1+3,n,1'];
const FRAME_VALUES = ['+34a (+24)', '-14c', '-9~-8', '+14 +64a', '+5g', '+1', '0', '-9', '-13'];

export function GalleryScreen() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [glyph, setGlyph] = useState<GlyphMode>('playstation');
  const [tab, setTab] = useState('one');
  const [toggle, setToggle] = useState(false);
  const [select, setSelect] = useState('ps5');
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([{ id: 'g1', message: 'Logged 8 of 10.', actionLabel: 'Undo' }]);
  const [stance, setStance] = useState<StanceId | null>('DGF');
  const [side, setSide] = useState<'P1' | 'P2'>('P1');
  const [unknowns, setUnknowns] = useState<string[]>([]);
  const iconEntries = Object.entries(Icons).filter(([k, v]) => k.startsWith('Icon') && typeof v === 'function');

  return (
    <div className="z-gallery" data-theme={theme}>
      <header className="z-gallery__head">
        <h1 className="z-display-m">Zanshin component gallery</h1>
        <p lang="ja" aria-hidden="true" className="z-gallery__ja">残心 · 守破離</p>
        <p className="z-body">Route /dev/gallery · development only. Sample data is spec text only.</p>
        <div className="z-gallery__switchers">
          <div role="group" aria-label="Theme">
            {(['dark', 'light'] as const).map((t) => <Button key={t} variant={theme === t ? 'primary' : 'secondary'} onClick={() => setTheme(t)}>{t}</Button>)}
          </div>
          <div role="group" aria-label="Glyph mode">
            {(['numeric', 'playstation', 'xbox'] as const).map((g) => <Button key={g} variant={glyph === g ? 'primary' : 'secondary'} onClick={() => setGlyph(g)}>{g}</Button>)}
          </div>
        </div>
      </header>

      <Section title="Buttons">
        <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="destructive">Destructive</Button>
        <Button disabled>Disabled</Button><Button lab>Lab 64px</Button><Button block>Block</Button>
        <IconButton ariaLabel="Search"><IconSearch /></IconButton>
        <IconButton ariaLabel="Close" outline><IconClose /></IconButton>
        <IconButton ariaLabel="Lab close" lab outline><IconClose /></IconButton>
      </Section>

      <Section title="Card / Chip / Tabs / Stepper">
        <Card title="Card title"><p className="z-body">Card body. Raised variant below.</p></Card>
        <Card title="Raised" raised><p className="z-body">Raised surface.</p></Card>
        <Chip>Default</Chip><Chip tone="filled">Filled</Chip><Chip tone="dashed">Dashed</Chip>
        <Chip tone="heat" icon={<Icons.IconHeat size={14} />}>Heat</Chip><Chip tone="warning">Warning</Chip>
        <Chip tone="low">Low</Chip><Chip tone="launch">Launch</Chip>
        <Tabs ariaLabel="Gallery tabs" tabs={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three, disabled', disabled: true }]} value={tab} onChange={setTab} />
        <Stepper steps={[{ id: 'a', label: 'Welcome' }, { id: 'b', label: 'Profile' }, { id: 'c', label: 'Calibrate' }]} currentIndex={1} />
      </Section>

      <Section title="Toggle / Select / TextField">
        <Toggle checked={toggle} onChange={setToggle} label="Heat lesson seen" />
        <Toggle checked disabled label="Disabled on" onChange={() => undefined} />
        <Select id="g-platform" label="Platform" value={select} onChange={setSelect} options={[{ value: 'ps5', label: 'PlayStation 5' }, { value: 'pc', label: 'PC' }, { value: 'xbox', label: 'Xbox' }]} hint="Glyphs follow platform." />
        <Select id="g-err" label="With error" value="ps5" onChange={() => undefined} options={[{ value: 'ps5', label: 'PlayStation 5' }]} error="Pick a platform." />
        <TextField id="g-name" label="Display name" value={text} onChange={setText} placeholder="Sagar" hint="Shown on Today." />
        <TextField id="g-notes" label="Notes" multiline value={text} onChange={setText} placeholder="One line after the session…" />
      </Section>

      <Section title="Sheet / Modal / Toast">
        <Button onClick={() => setSheet(true)}>Open sheet</Button>
        <Button variant="secondary" onClick={() => setModal(true)}>Open modal</Button>
        <Button variant="secondary" onClick={() => setToasts([{ id: `t${Date.now()}`, message: 'Saved.', actionLabel: 'Undo' }])}>Show toast</Button>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Stance sheet"><p className="z-body">Sheet content. Focus is trapped; Escape or the scrim closes it, and focus returns here.</p></Sheet>
        <Modal open={modal} onClose={() => setModal(false)} title="Confirm" actions={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button onClick={() => setModal(false)}>Confirm</Button></>}>
          <p className="z-body">Modal content with footer actions.</p>
        </Modal>
        <Toast toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      </Section>

      <Section title="Empty / Error / Skeleton / Progress / StatTile / DataBadge">
        <EmptyState title="No logs yet" body="Your first session will appear here." />
        <ErrorState title="Couldn't reach Wavu Wiki" body="Using your saved data from Oct 29. Retry?" onRetry={() => undefined} />
        <Skeleton width={220} height={20} /><Skeleton width={160} height={14} />
        <ProgressLine value={62} ariaLabel="Session progress" />
        <ProgressLine value={40} tone="mastery" ariaLabel="Mastery progress" />
        <ProgressLine value={80} tone="heat" ariaLabel="Heat gauge" />
        <StatTile label="Missed punishes / game" value="1.4" target="1.0" trend="down" trendText="0.3 better than last week" />
        <StatTile label="BnB both sides" value="8/10" target="8/10" trend="up" trendText="Target met" />
        <DataBadge status="verified" detail="Checked in Practice" />
        <DataBadge status="sourced" detail="Wavu Wiki" />
        <DataBadge status="conflicting" onClick={() => undefined} />
        <DataBadge status="unverified" />
      </Section>

      <Section title="InputString — all glyph modes, all sizes">
        {(['small', 'medium', 'large'] as const).map((size) => (
          <div key={size} className="z-gallery__col">
            <p className="z-label">{size}</p>
            {NOTATIONS.map((n) => (
              <InputString key={`${size}-${n}`} input={n} glyphMode={glyph} size={size} showCopy onUnknownToken={(t) => setUnknowns((u) => [...new Set([...u, t])])} />
            ))}
          </div>
        ))}
        {unknowns.length > 0 && <p className="z-caption">Unknown tokens: {unknowns.join(', ')}</p>}
      </Section>

      <Section title="FrameValue — tiers, suffixes, ranges, parentheticals">
        {FRAME_VALUES.map((v) => <FrameValue key={v} value={v} />)}
        <p className="z-caption">Suffixes: a airborne · b back-turned · c crouching · d downed · g guardable · s stagger · w wall crush.</p>
      </Section>

      <Section title="HitLevelChips">
        <HitLevelChips levels="H,H,M" /><HitLevelChips levels="h,m,l" /><HitLevelChips levels="sm,sl" />
        <HitLevelChips levels="T" /><HitLevelChips levels="!" /><HitLevelChips levels="H,M,L" />
      </Section>

      <Section title="FrameBar">
        <FrameBar startup={15} active={3} recovery={24} resultText="On block you are −13: punishable by any i13 move." />
        <FrameBar startup={6} active={2} resultText="On block you are +2: your turn continues." />
        <FrameBar startup={60} active={10} recovery={60} resultText="Long move, auto-scaled: 1 tick = 5f." />
      </Section>

      <Section title="PunishLadder">
        <PunishLadder
          highlightRung={-13} glyphMode={glyph}
          punishers={{
            [-10]: { standing: { notation: '1,2' }, crouching: { notation: 'FC.1' } },
            [-13]: { standing: { notation: 'df+1,4' }, crouching: { notation: 'FC.df+1' } },
            [-15]: { standing: { notation: 'df+2' }, crouching: { notation: 'ws+2' } },
          }}
        />
      </Section>

      <Section title="StanceMap">
        <StanceMap selected={stance} onSelect={setStance} />
        <p className="z-body">Selected: {stance ?? 'none'}. Tab + arrow keys move between nodes.</p>
      </Section>

      <Section title="EnsoRing — states">
        <EnsoRing score={0} label="New" /><EnsoRing score={42} label="Learning" /><EnsoRing score={78} label="Solid" />
        <EnsoRing score={100} label="Mastered" /><EnsoRing score={55} state="rusty" label="Rusty" />
        <EnsoRing state="locked" label="Locked" /><EnsoRing score={63} size={140} label="Large" />
      </Section>

      <Section title="HeatGauge — states">
        <HeatGauge state="available" /><HeatGauge state="active" fill={0.6} /><HeatGauge state="spent" />
      </Section>

      <Section title="RepLogger">
        <RepLogger reps={10} setLabel="Set 2 of 3" targetLabel="Target 8/10" showSideToggle side={side} onSideChange={setSide} onLog={() => undefined} onUndo={() => undefined} />
      </Section>

      <Section title="DrillCard / MatchupCard / CoachMessage / PatchBanner">
        <DrillCard
          drill={{ title: 'Bread-and-butter, both sides', why: 'Your combo drops after the tornado.', target: '8/10 on both sides', recipe: 'Practice mode, dummy standing, no recording.', steps: ['Land the launcher.', 'Dash, then the tornado ender.', 'Repeat on P2 side.'], progression: 'Add a wall carry.', regression: 'Drill the tornado segment alone: 3 sets.', history: [4, 6, 7, 8, 9] }}
          onStart={() => undefined}
        />
        <MatchupCard character="Kazuya" wins={6} losses={4} glyphMode={glyph} problemMoves={[{ notation: 'df+2', answer: 'Sidestep left, then punish.', note: 'Most common opener seen.' }]} />
        <CoachMessage message="2.6 missed punishes per game against a target of 1.0. Most were −13 or −14: df+1,4 or b+2,2." citations={[{ id: 'move-df14', label: 'df+1,4 in Codex' }, { id: 'punish', label: 'Punish ladder' }]} onCite={() => undefined} />
        <PatchBanner changes={[{ move: 'df+2', change: 'Startup changed in the latest patch.', reverify: 'df+2 on block in Practice' }]} onDismiss={() => undefined} />
      </Section>

      <Section title="Icons — §4.6 groups">
        <div className="z-gallery__icons">
          {iconEntries.map(([name, C]) => {
            const Icon = C as (p: { size?: number }) => React.ReactNode;
            return <span key={name} className="z-gallery__icon" title={name}><Icon size={24} /><span className="z-caption">{name}</span></span>;
          })}
        </div>
      </Section>

      <Section title="Lab Mode scale">
        <div className="z-lab z-gallery__lab">
          <Button lab>Lab button, 64px</Button>
          <p className="z-body-l">Lab body text at 1.35×.</p>
          <RepLogger reps={5} setLabel="Set 1 of 3" targetLabel="Target 4/5" onLog={() => undefined} />
        </div>
      </Section>
    </div>
  );
}
