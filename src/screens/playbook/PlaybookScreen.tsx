// Playbook — spec §5.11 / §10.13. The counterplay table and the six
// game plans. Every item links to at least one move or drill (AC-PB-1).
import './Playbook.css';
import { PageHeader } from '../../components/layout/PageHeader';
import { Link } from 'react-router-dom';
import { Card } from '../../components/base/Card';
import { InputString } from '../../components/signature/InputString';
import { loadCurriculum, loadMovesYoshimitsu, loadPlaybook } from '../../data/packs';

export function PlaybookScreen() {
  const playbook = loadPlaybook();
  const moves = loadMovesYoshimitsu();
  const curriculum = loadCurriculum();
  const moveById = new Map(moves.map((m) => [m.id, m]));
  const nodeByDrill = new Map(curriculum.drills.map((d) => [d.id, curriculum.nodes.find((n) => n.id === d.nodeId)]));

  return (
    <main>
      <PageHeader level={1} eyebrow="Game plans" title="Playbook" lede="What opponents do to Yoshimitsu and how to answer it, plus the plans that win rounds." />

      <Card title="Counterplay — what they do to Yoshimitsu" className="z-playbook">
        <div className="z-playbook__grid">
        {playbook.counterplay.map((item) => (
          <div key={item.id} className="z-playbook__item">
            <h2>{item.whatTheyDo}</h2>
            <p>{item.answer}</p>
            <p className="z-playbook__beats"><span className="z-playbook__label">Beats</span> {item.whatItBeats}</p>
            <p className="z-playbook__moves">
              <span className="z-playbook__label">Moves</span>{' '}
              {(item.moveIds ?? []).map((id) => {
                const move = moveById.get(id);
                return move ? (
                  <span key={id}><Link to={`/codex/moves/${encodeURIComponent(id)}`}><InputString input={move.input} /></Link>{' '}</span>
                ) : <span key={id}>{id} </span>;
              })}
            </p>
            <p className="z-playbook__drills">
              <span className="z-playbook__label">Drills</span>{' '}
              {item.drillIds.map((id) => {
                const node = nodeByDrill.get(id);
                return node ? (
                  <span key={id}><Link to={`/path/${node.id}`}>{node.title}</Link>{' '}</span>
                ) : <span key={id}>{id} </span>;
              })}
            </p>
          </div>
        ))}
        </div>
      </Card>

      <Card title="Game plans">
        {playbook.plans.map((plan) => (
          <div key={plan.id}>
            <h2>{plan.title}</h2>
            <p>When: {plan.when}</p>
            <p>
              Core moves:{' '}
              {(plan.coreMoveIds ?? []).map((id) => {
                const move = moveById.get(id);
                return move ? (
                  <span key={id}><Link to={`/codex/moves/${encodeURIComponent(id)}`}><InputString input={move.input} /></Link>{' '}</span>
                ) : <span key={id}>{id} </span>;
              })}
            </p>
            <p>Risks: {plan.risks}</p>
            <p>
              Drills:{' '}
              {plan.drillIds.map((id) => {
                const node = nodeByDrill.get(id);
                return node ? (
                  <span key={id}><Link to={`/path/${node.id}`}>{node.title}</Link>{' '}</span>
                ) : <span key={id}>{id} </span>;
              })}
            </p>
          </div>
        ))}
      </Card>
    </main>
  );
}
