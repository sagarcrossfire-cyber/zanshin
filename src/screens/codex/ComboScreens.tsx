// Combo library and detail — spec §5.8. Combos are learned as segments
// that can be practiced alone; "Practice this" creates a draft Lab session
// of segment drills followed by the full route (AC-COMBO-2). Success rate
// is successes divided by reps across the combo's sets (AC-COMBO-3).
import { PageHeader } from '../../components/layout/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { DataBadge } from '../../components/base/DataBadge';
import { InputString } from '../../components/signature/InputString';
import { loadCombos } from '../../data/packs';
import { sessionsRepo, setsRepo } from '../../data/repos';
import { buildPracticeSession, comboSuccessRate, fullRouteDrillId, routeSteps, segmentDrillId } from '../../domain/codex/combo';
import { useAppStore } from '../../stores/appStore';
import type { Combo, DrillSet } from '../../data/schemas';
import './Codex.css';

const KIND_LABELS: Record<Combo['kind'], string> = {
  beginner: 'Beginner',
  bnb: 'Bread and butter',
  staple: 'Staple',
  heat: 'Heat',
  wall: 'Wall',
  float: 'Float',
  bt: 'Back-turned',
  stage: 'Stage',
  mini: 'Mini',
  extra: 'Extra',
};

function kindOrder(kind: Combo['kind']): number {
  return (Object.keys(KIND_LABELS) as Array<Combo['kind']>).indexOf(kind);
}

export function ComboLibraryScreen() {
  const [setsByDrill, setSetsByDrill] = useState<Map<string, DrillSet[]>>(new Map());
  const combos = useMemo(() => loadCombos(), []);

  useEffect(() => {
    let cancelled = false;
    void setsRepo.all().then((sets) => {
      if (cancelled) return;
      const byDrill = new Map<string, DrillSet[]>();
      for (const set of sets) {
        const list = byDrill.get(set.drillId) ?? [];
        list.push(set);
        byDrill.set(set.drillId, list);
      }
      setSetsByDrill(byDrill);
    });
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const groups = new Map<Combo['kind'], Combo[]>();
    for (const combo of [...combos].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name))) {
      const list = groups.get(combo.kind) ?? [];
      list.push(combo);
      groups.set(combo.kind, list);
    }
    return groups;
  }, [combos]);

  return (
    <div className="z-codex">
      <PageHeader eyebrow="Codex · Yoshimitsu" title="Combos" lede="Routes from beginner to wall carry, each with its starter and difficulty. Practise the segments alone, then the whole route." />
      {[...grouped.entries()].map(([kind, list]) => (
        <section key={kind} aria-label={KIND_LABELS[kind]}>
          <h2 className="z-section-title">{KIND_LABELS[kind]}</h2>
          <ul className="z-codex__list">
            {list.map((combo) => {
              const sets = [
                ...(setsByDrill.get(fullRouteDrillId(combo.id)) ?? []),
                ...combo.segments.flatMap((_, i) => setsByDrill.get(segmentDrillId(combo.id, i)) ?? []),
              ];
              const rate = comboSuccessRate(sets);
              return (
                <li key={combo.id} className="z-codex__row">
                  <Link className="z-codex__link" to={`/codex/combos/${encodeURIComponent(combo.id)}`}>
                    <strong>{combo.name}</strong>
                    <span>Starter: {combo.starters.join(' or ')}</span>
                    {combo.damage !== undefined && <span>{combo.damage} damage</span>}
                    {combo.requires.length > 0 && <span>Requires: {combo.requires.join(', ')}</span>}
                    <span>Difficulty {combo.difficulty}/5</span>
                    <span>{rate === null ? 'No attempts yet' : `Success rate ${Math.round(rate * 100)}%`}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ComboDetailScreen() {
  const { comboId } = useParams<{ comboId: string }>();
  const profile = useAppStore((s) => s.profile);
  const glyphMode = profile?.glyphMode ?? 'playstation';
  const pushToast = useAppStore((s) => s.pushToast);
  const combos = useMemo(() => loadCombos(), []);
  const decodedId = comboId ? decodeURIComponent(comboId) : '';
  const combo = combos.find((c) => c.id === decodedId);

  if (!combo) {
    return (
      <Card title="Combo not found">
        <p className="z-body-l">No combo with id “{decodedId}” is in the pack.</p>
        <Link to="/codex/combos"><Button>Back to the combo library</Button></Link>
      </Card>
    );
  }

  const steps = routeSteps(combo.route);
  const practiceThis = () => {
    const session = buildPracticeSession(combo, new Date().toISOString());
    void sessionsRepo.put(session).then(() => {
      pushToast(`Draft Lab session created: ${combo.name} (${session.blocks.length} blocks).`);
    });
  };

  return (
    <div className="z-codex">
      <Card title={combo.name}>
        <p className="z-body-l">Starter: {combo.starters.join(' or ')}</p>
        <DataBadge
          status={combo.provenance.status === 'verified' ? 'verified' : 'unverified'}
          detail={`${combo.provenance.source} · ${combo.provenance.patch}`}
        />
        <p className="z-body-l">Kind: {KIND_LABELS[combo.kind]} · Difficulty {combo.difficulty}/5</p>
        {combo.damage !== undefined && <p className="z-body-l">Damage: {combo.damage}</p>}
        {combo.requires.length > 0 && <p className="z-body-l">Requires: {combo.requires.join(', ')}</p>}
        {combo.notes && <p className="z-body-l">{combo.notes}</p>}
      </Card>

      <Card title="Route">
        <ol className="z-codex__steps">
          {steps.map((step, i) => (
            <li key={i}><InputString input={step} glyphMode={glyphMode} /></li>
          ))}
        </ol>
      </Card>

      <Card title="Segments — practice each alone">
        <ol className="z-codex__steps">
          {combo.segments.map((segment, i) => (
            <li key={i}>
              <span className="z-label">Segment {i + 1}</span>
              <InputString input={segment} glyphMode={glyphMode} />
            </li>
          ))}
        </ol>
        <Button onClick={practiceThis}>Practice this</Button>
      </Card>
    </div>
  );
}
