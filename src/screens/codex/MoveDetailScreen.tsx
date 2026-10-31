// Move detail — spec §5.6. FrameBar (when the pack's frames parse),
// stats grid, "Use it for", risks in words, opponent's answer, parent and
// follow-ups, combos and drills that use the move, Sagar's notes and
// verification history, and a Wavu link-out (never an embed).
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { DataBadge } from '../../components/base/DataBadge';
import { TextField } from '../../components/base/TextField';
import { FrameBar } from '../../components/signature/FrameBar';
import { FrameValue } from '../../components/signature/FrameValue';
import { HitLevelChips } from '../../components/signature/HitLevelChips';
import { InputString } from '../../components/signature/InputString';
import { loadCombos, loadConflicts, loadCurriculum, loadMovesYoshimitsu } from '../../data/packs';
import { moveNotesRepo, verificationsRepo } from '../../data/repos';
import { recoversInto } from '../../domain/codex/filters';
import { opponentAnswers, parseFrameParts, riskSentences, splitNotes, wavuMoveUrl } from '../../domain/codex/riskText';
import { useAppStore } from '../../stores/appStore';
import './Codex.css';

export function MoveDetailScreen() {
  const { moveId } = useParams<{ moveId: string }>();
  const profile = useAppStore((s) => s.profile);
  const glyphMode = profile?.glyphMode ?? 'playstation';
  const pushToast = useAppStore((s) => s.pushToast);
  const moves = useMemo(() => loadMovesYoshimitsu(), []);
  const decodedId = moveId ? decodeURIComponent(moveId) : '';
  const move = moves.find((m) => m.id === decodedId);
  const [noteDraft, setNoteDraft] = useState('');
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Array<{ field: string; expected: string; result: string; patch: string }>>([]);

  const conflicts = useMemo(
    () => loadConflicts().filter((c) => c.entityId === decodedId && c.status === 'open'),
    [decodedId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!decodedId) return;
    void moveNotesRepo.get(decodedId).then((note) => {
      if (!cancelled) {
        setSavedNote(note?.note ?? null);
        setNoteDraft(note?.note ?? '');
      }
    });
    void verificationsRepo.allByEntity(decodedId).then((records) => {
      if (!cancelled) setVerifications(records);
    });
    return () => { cancelled = true; };
  }, [decodedId]);

  const combos = useMemo(() => {
    if (!move) return [];
    return loadCombos().filter((combo) =>
      combo.segments.some((segment) => segment.split(/[,\s]+/).includes(move.input)),
    );
  }, [move]);

  const drills = useMemo(() => {
    if (!move) return [];
    return loadCurriculum().drills.filter((drill) => drill.codexRefs.includes(move.id));
  }, [move]);

  if (!move) {
    return (
      <Card title="Move not found">
        <p className="z-body-l">No Yoshimitsu move with id “{decodedId}” is in the pack.</p>
        <Link to="/codex/moves"><Button>Back to the move explorer</Button></Link>
      </Card>
    );
  }

  const parent = move.parentId ? moves.find((m) => m.id === move.parentId) : undefined;
  const followUps = moves.filter((m) => m.parentId === move.id);
  const frameParts = parseFrameParts(move);
  const { bullets, role } = splitNotes(move);
  const risks = riskSentences(move);
  const answers = opponentAnswers(move);
  const into = recoversInto(move);

  const saveNote = () => {
    void moveNotesRepo
      .put({ moveId: move.id, character: 'Yoshimitsu', note: noteDraft, updatedAt: new Date().toISOString() })
      .then(() => {
        setSavedNote(noteDraft);
        pushToast('Note saved.');
      });
  };

  return (
    <div className="z-codex">
      <Card title={move.name ?? move.input}>
        <InputString input={move.input} glyphMode={glyphMode} size="large" />
        {move.aliases.length > 0 && (
          <p className="z-body-l">Also known as: {move.aliases.join(', ')}</p>
        )}
        <HitLevelChips levels={move.hitLevel} />
        <DataBadge
          status={conflicts.length > 0 ? 'conflicting' : move.provenance.status === 'verified' ? 'verified' : 'unverified'}
          detail={`${move.provenance.source} · ${move.provenance.patch}`}
        />
      </Card>

      {frameParts && (
        <Card title="Frame bar">
          <FrameBar
            startup={frameParts.startup}
            active={frameParts.active}
            recovery={frameParts.recovery}
            resultText={move.block !== undefined ? `On block: ${move.block.replace(/-/g, '−')}` : 'Block value not published.'}
          />
        </Card>
      )}

      <Card title="Stats">
        <dl className="z-codex__stats">
          <dt>Damage</dt><dd>{move.damage}</dd>
          <dt>Startup</dt><dd>{move.startup.replace(/^,/, '')}</dd>
          {move.block !== undefined && (<><dt>Block</dt><dd><FrameValue value={move.block} /></dd></>)}
          {move.hit !== undefined && (<><dt>Hit</dt><dd><FrameValue value={move.hit} /></dd></>)}
          {move.counterHit !== undefined && (<><dt>Counter hit</dt><dd><FrameValue value={move.counterHit} /></dd></>)}
          {move.crush !== undefined && (<><dt>Crush</dt><dd>{move.crush}</dd></>)}
          {move.recovery !== undefined && (<><dt>Recovery</dt><dd>{move.recovery}</dd></>)}
          {into && (<><dt>Recovers into</dt><dd>{into}</dd></>)}
          {move.total !== undefined && (<><dt>Total frames</dt><dd>{move.total}</dd></>)}
        </dl>
      </Card>

      {(role || bullets.length > 0) && (
        <Card title="Use it for">
          {role && <p className="z-body-l">{role}</p>}
          {bullets.length > 0 && (
            <ul>{bullets.map((bullet, i) => <li key={i}>{bullet}</li>)}</ul>
          )}
        </Card>
      )}

      {risks.length > 0 && (
        <Card title="Risks">
          <ul>{risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul>
        </Card>
      )}

      {answers.length > 0 && (
        <Card title="Opponent's answer">
          <ul>{answers.map((answer, i) => <li key={i}>{answer}</li>)}</ul>
        </Card>
      )}

      {(parent || followUps.length > 0) && (
        <Card title="String">
          {parent && (
            <p className="z-body-l">Part of: <Link to={`/codex/moves/${encodeURIComponent(parent.id)}`}>{parent.input}</Link></p>
          )}
          {followUps.length > 0 && (
            <ul>
              {followUps.map((followUp) => (
                <li key={followUp.id}>
                  <Link to={`/codex/moves/${encodeURIComponent(followUp.id)}`}>{followUp.input}</Link>
                  {followUp.name ? ` — ${followUp.name}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(combos.length > 0 || drills.length > 0) && (
        <Card title="Used in">
          {combos.map((combo) => (
            <p key={combo.id} className="z-body-l">
              Combo: <Link to={`/codex/combos/${encodeURIComponent(combo.id)}`}>{combo.name}</Link>
            </p>
          ))}
          {drills.map((drill) => (
            <p key={drill.id} className="z-body-l">Drill: {drill.title}</p>
          ))}
        </Card>
      )}

      <Card title="Your notes">
        <TextField id="move-note" label="Notes on this move" multiline value={noteDraft}
          onChange={setNoteDraft} hint={savedNote === null ? 'No note saved yet.' : 'A note is saved for this move.'} />
        <Button onClick={saveNote}>Save note</Button>
      </Card>

      {verifications.length > 0 && (
        <Card title="Verification history">
          <ul>
            {verifications.map((record, i) => (
              <li key={i}>{record.field}: expected {record.expected} — {record.result} (patch {record.patch})</li>
            ))}
          </ul>
        </Card>
      )}

      <p className="z-body-l">
        <a href={wavuMoveUrl(move.id)} target="_blank" rel="noreferrer">Watch on Wavu ↗</a>
        {' '}· Source: {move.provenance.sourceUrl ?? 'Wavu Wiki'} · Patch {move.provenance.patch}
      </p>
    </div>
  );
}
