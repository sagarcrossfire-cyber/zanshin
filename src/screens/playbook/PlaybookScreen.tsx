// Playbook — spec §5.11 / §10.13. The counterplay table and the six
// game plans. Every item links to at least one move or drill (AC-PB-1).
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
      <h1>Playbook</h1>

      <Card title="Counterplay — what they do to Yoshimitsu">
        {playbook.counterplay.map((item) => (
          <div key={item.id}>
            <h2>{item.whatTheyDo}</h2>
            <p>{item.answer}</p>
            <p>Beats: {item.whatItBeats}</p>
            <p>
              Moves:{' '}
              {(item.moveIds ?? []).map((id) => {
                const move = moveById.get(id);
                return move ? (
                  <span key={id}><Link to={`/codex/moves/${encodeURIComponent(id)}`}><InputString input={move.input} /></Link>{' '}</span>
                ) : <span key={id}>{id} </span>;
              })}
            </p>
            <p>
              Drills:{' '}
              {item.drillIds.map((id) => {
                const node = nodeByDrill.get(id);
                return node ? (
                  <span key={id}><Link to={`/path/${node.id}`}>{node.title}</Link>{' '}</span>
                ) : <span key={id}>{id} </span>;
              })}
            </p>
          </div>
        ))}
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
