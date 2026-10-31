// Heat — spec §5.9. Universal Heat rules (§10.2) and Yoshimitsu's Heat kit
// (§10.8). Every fact carries its source and patch (AC-HEAT-1); every Heat
// Engager links to its move detail (AC-HEAT-2). Season 3 gauge numbers are
// flagged as possibly stale per §10.2.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/base/Card';
import { DataBadge } from '../../components/base/DataBadge';
import { HeatGauge } from '../../components/signature/HeatGauge';
import { InputString } from '../../components/signature/InputString';
import { DATA_PATCH } from '../../data/packs';
import { loadMovesYoshimitsu } from '../../data/packs';
import { useAppStore } from '../../stores/appStore';
import './Codex.css';

interface HeatFact {
  text: string;
  source: string;
  patch: string;
  verify?: boolean;
}

const UNIVERSAL_FACTS: HeatFact[] = [
  { text: 'Heat Burst (2+3) once per round before Heat is active; it is a power crush and cannot KO. Landing a Heat Engager restores at least 30 recoverable health.', source: 'Wavu: Heat', patch: '3.02.02' },
  { text: 'The Heat gauge is 900 frames and drains steadily; Heat Burst consumes 300; landing and blocking attacks also drain it. Once empty, Heat is gone for the round.', source: 'Wavu: Heat (documents Seasons 1–2)', patch: '3.02.02', verify: true },
  { text: 'In Heat, attacks chip on block; recoverable health returns faster; characters gain Heat-only moves. Heat Smash (2+3 again) spends all remaining Heat for high damage and breaks walls and floors. Heat Dash (forward after a landed engager) spends the rest and is +5g on block.', source: 'Wavu: Heat', patch: '3.02.02' },
  { text: 'Patch 3.00.02 raised the Heat cost and cut the power of Heat moves for nearly every character, so the gauge numbers above may be stale. A Stage 4 verify task checks them in Practice.', source: 'Shacknews coverage of 3.00.02', patch: '3.00.02', verify: true },
];

const ENGAGERS = ['3,1', 'f+1+2', 'b+2,2', 'KIN.f+2', 'DGF.4', '3,NSS.1', 'b+2,NSS.2', 'NSS.f+1+2'];

const KIT_FACTS: HeatFact[] = [
  { text: 'Heat Burst 2+3: mid, i16, +1 on block, +2c on hit; a power crush.', source: 'Wavu', patch: '3.02.02' },
  { text: 'Heat powers: powered-up NSS moves in 1SS. TekkenDocs adds that ub+1+2, f+1+2 and 1+4 gain range, damage, chip and healing — that sheet predates the Season 2 nerf to sword damage and healing, so verify in Practice.', source: 'Wavu; TekkenDocs anti-strat sheet', patch: '3.02.02', verify: true },
  { text: 'Heat-only moves: H.DGF.1 (mid, +2 on block, +30d on hit) and H.DGF.f+1+2 (three highs, +4 on block, homing).', source: 'Wavu', patch: '3.02.02' },
  { text: 'Heat Smash H.2+3: 51 damage, i18~19, +4 on block, −3d on hit, heals on hit, breaks walls and balconies. TekkenDocs lists it at +10 when he holds into DGF.', source: 'Wavu; TekkenDocs', patch: '3.02.02' },
  { text: 'In Heat, 3,1 becomes a full launcher and f+1+2 launches — verify in Practice.', source: 'TekkenDocs May 2026 guide', patch: '3.02.02', verify: true },
  { text: 'Heat combo starters: H.f1+2f [20], H.b2,2f [33], H.DGF.4f [24] and H.3,1f [37], each continuing d2,2b 1+4 md d2,2b 1 f3+4 d2,2,2 T! 3,1; not on Kuma or Panda.', source: 'Wavu staples', patch: '3.02.02' },
];

const CHECKLIST = [
  'Heat Burst when you need the round now and have no engager confirm — it cannot KO, so do not waste it on a sliver.',
  'Engage off a confirm (3,1, f+1+2, b+2,2) so the gauge starts with momentum, not from neutral.',
  'Spend the gauge on purpose: Heat Smash for the kill, Heat Dash to keep pressure after a landed engager.',
  'Do not enter Heat with nothing planned — an empty gauge is gone for the round.',
];

function FactList({ facts }: { facts: HeatFact[] }) {
  return (
    <ul className="z-codex__facts">
      {facts.map((fact, i) => (
        <li key={i}>
          <p className="z-body-l">{fact.text}</p>
          <p className="z-label">Source: {fact.source} · Patch {fact.patch}{fact.verify ? ' · Verify in Practice' : ''}</p>
        </li>
      ))}
    </ul>
  );
}

export function HeatScreen() {
  const profile = useAppStore((s) => s.profile);
  const glyphMode = profile?.glyphMode ?? 'playstation';
  const moves = useMemo(() => loadMovesYoshimitsu(), []);
  const moveByInput = useMemo(() => new Map(moves.map((m) => [m.input, m])), [moves]);

  return (
    <div className="z-codex">
      <Card title="Heat — the gauge">
        <HeatGauge state="available" />
        <p className="z-body-l">900 frames, draining steadily. Heat Burst consumes 300. The gauge numbers may be stale after patch 3.00.02 — a Stage 4 verify task checks them in Practice.</p>
        <DataBadge status="unverified" detail={`Wavu: Heat · ${DATA_PATCH}`} />
      </Card>

      <Card title="Universal Heat rules">
        <FactList facts={UNIVERSAL_FACTS} />
      </Card>

      <Card title="Yoshimitsu's Heat Engagers">
        <ul>
          {ENGAGERS.map((input) => {
            const move = moveByInput.get(input);
            return (
              <li key={input}>
                {move ? (
                  <Link to={`/codex/moves/${encodeURIComponent(move.id)}`}>
                    <InputString input={input} glyphMode={glyphMode} />
                  </Link>
                ) : (
                  <InputString input={input} glyphMode={glyphMode} />
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Yoshimitsu's Heat kit">
        <FactList facts={KIT_FACTS} />
      </Card>

      <Card title="When to Heat Burst, when to engage">
        <ul>
          {CHECKLIST.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
        <p className="z-label">Checklist guidance from the §5.9/§10.8 plan; the facts above carry their sources.</p>
      </Card>
    </div>
  );
}
