// Move explorer — spec §5.6. In-memory search index over input, name and
// aliases; filters combine with AND; result count shows; clearing restores
// the full list (AC-MOVES-1–3). Deep links are URL-encoded move ids (AC-MOVES-4).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Chip } from '../../components/base/Chip';
import { DataBadge } from '../../components/base/DataBadge';
import { Select } from '../../components/base/Select';
import { TextField } from '../../components/base/TextField';
import { FrameValue } from '../../components/signature/FrameValue';
import { HitLevelChips } from '../../components/signature/HitLevelChips';
import { InputString } from '../../components/signature/InputString';
import { ClipBadge } from '../../components/media/MoveClip';
import { loadConflicts, loadMovesYoshimitsu } from '../../data/packs';
import { moveNotesRepo } from '../../data/repos';
import { buildMoveIndex, searchMoves } from '../../domain/codex/search';
import {
  blockTier, EMPTY_FILTERS, moveMatchesFilters, sortMoves, stanceOf,
  type BlockTier, type MoveFilters, type MoveSort, type StartupBucket, type StanceFilter,
} from '../../domain/codex/filters';
import type { MoveTag } from '../../data/schemas';
import { useAppStore } from '../../stores/appStore';
import './Codex.css';

const HIT_LEVELS = [
  { value: 'H', label: 'High' },
  { value: 'M', label: 'Mid' },
  { value: 'L', label: 'Low' },
  { value: 'T', label: 'Throw' },
  { value: '!', label: 'Unblockable' },
];
const STARTUP_BUCKETS: Array<{ value: StartupBucket; label: string }> = [
  { value: 'fast', label: 'i10 or faster' },
  { value: 'mid-fast', label: 'i11–13' },
  { value: 'mid', label: 'i14–15' },
  { value: 'slow', label: 'i16 or slower' },
];
const BLOCK_TIERS: Array<{ value: BlockTier; label: string }> = [
  { value: 'plus', label: 'Plus' },
  { value: 'safe', label: 'Safe' },
  { value: 'punishable', label: 'Punishable' },
  { value: 'launch', label: 'Launch punishable' },
];
const STANCES: Array<{ value: StanceFilter; label: string }> = [
  { value: '1SS', label: '1SS' },
  { value: 'NSS', label: 'NSS' },
  { value: 'DGF', label: 'DGF' },
  { value: 'KIN', label: 'KIN' },
  { value: 'FLE', label: 'FLE' },
  { value: 'IND', label: 'IND' },
  { value: 'MED', label: 'MED' },
  { value: 'BT', label: 'BT' },
  { value: 'BDS', label: 'BDS' },
  { value: 'WFL', label: 'WFL' },
  { value: 'crouch', label: 'Crouch' },
  { value: 'while-standing', label: 'While standing' },
];
const PROPERTIES: Array<{ value: MoveTag; label: string }> = [
  { value: 'heat-engager', label: 'Heat Engager' },
  { value: 'heat-only', label: 'Heat-only' },
  { value: 'homing', label: 'Homing' },
  { value: 'power-crush', label: 'Power crush' },
  { value: 'launcher', label: 'Launcher' },
  { value: 'ch-launcher', label: 'Counter-hit launcher' },
  { value: 'tornado', label: 'Tornado' },
  { value: 'wall-splat', label: 'Wall splat' },
  { value: 'floor-break', label: 'Floor break' },
  { value: 'balcony-break', label: 'Balcony break' },
  { value: 'unblockable', label: 'Unblockable' },
  { value: 'hp-cost', label: 'HP cost' },
  { value: 'parry', label: 'Parry' },
  { value: 'low-crush', label: 'Low crush' },
  { value: 'high-crush', label: 'High crush' },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MoveExplorerScreen() {
  const profile = useAppStore((s) => s.profile);
  const glyphMode = profile?.glyphMode ?? 'playstation';
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<MoveFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<MoveSort>('num');
  const [notedIds, setNotedIds] = useState<ReadonlySet<string>>(new Set());
  const moves = useMemo(() => loadMovesYoshimitsu(), []);
  const index = useMemo(() => buildMoveIndex(moves), [moves]);
  const conflictingIds = useMemo(
    () => new Set(loadConflicts().filter((c) => c.status === 'open').map((c) => c.entityId)),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void moveNotesRepo.all().then((notes) => {
      if (!cancelled) setNotedIds(new Set(notes.map((n) => n.moveId)));
    });
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(() => {
    const searched = searchMoves(index, query);
    const filtered = searched.filter((move) => moveMatchesFilters(move, filters, notedIds, conflictingIds));
    // While a text query is active, search relevance order wins (E2: "flash"
    // surfaces 1+4 first); the sort control governs browsing the full list.
    return query.trim() === '' ? sortMoves(filtered, sort) : filtered;
  }, [index, query, filters, notedIds, conflictingIds, sort]);

  const activeFilterCount =
    filters.hitLevels.length + filters.startupBuckets.length + filters.blockTiers.length +
    filters.stances.length + filters.properties.length + filters.statuses.length + (filters.hasNotes ? 1 : 0);

  return (
    <div className="z-codex">
      <TextField id="move-search" label="Search moves" value={query}
        onChange={setQuery} placeholder="Try “flash”, “cd2” or “1+4”" type="search" />
      <div className="z-codex__filters" aria-label="Filters">
        <div className="z-codex__group" aria-label="Hit level">
          <span className="z-label">Hit level</span>
          {HIT_LEVELS.map((h) => (
            <Chip key={h.value} tone={filters.hitLevels.includes(h.value) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, hitLevels: toggle(filters.hitLevels, h.value) })}>{h.label}</Chip>
          ))}
        </div>
        <div className="z-codex__group" aria-label="Startup">
          <span className="z-label">Startup</span>
          {STARTUP_BUCKETS.map((b) => (
            <Chip key={b.value} tone={filters.startupBuckets.includes(b.value) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, startupBuckets: toggle(filters.startupBuckets, b.value) })}>{b.label}</Chip>
          ))}
        </div>
        <div className="z-codex__group" aria-label="Block tier">
          <span className="z-label">On block</span>
          {BLOCK_TIERS.map((b) => (
            <Chip key={b.value} tone={filters.blockTiers.includes(b.value) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, blockTiers: toggle(filters.blockTiers, b.value) })}>{b.label}</Chip>
          ))}
        </div>
        <div className="z-codex__group" aria-label="Stance">
          <span className="z-label">Stance</span>
          {STANCES.map((s) => (
            <Chip key={s.value} tone={filters.stances.includes(s.value) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, stances: toggle(filters.stances, s.value) })}>{s.label}</Chip>
          ))}
        </div>
        <div className="z-codex__group" aria-label="Properties">
          <span className="z-label">Properties</span>
          {PROPERTIES.map((p) => (
            <Chip key={p.value} tone={filters.properties.includes(p.value) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, properties: toggle(filters.properties, p.value) })}>{p.label}</Chip>
          ))}
        </div>
        <div className="z-codex__group" aria-label="My status">
          <span className="z-label">My status</span>
          {(['verified', 'unverified', 'conflicting'] as const).map((s) => (
            <Chip key={s} tone={filters.statuses.includes(s) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, statuses: toggle(filters.statuses, s) })}>{s}</Chip>
          ))}
          <Chip tone={filters.hasNotes ? 'filled' : 'default'}
            onClick={() => setFilters({ ...filters, hasNotes: !filters.hasNotes })}>Has notes</Chip>
        </div>
      </div>
      <div className="z-codex__bar">
        <p className="z-body-l" role="status">{results.length} of {moves.length} moves</p>
        <Select id="move-sort" label="Sort by" value={sort}
          options={[
            { value: 'num', label: 'Wavu move number' },
            { value: 'startup', label: 'Startup' },
            { value: 'block', label: 'Block' },
            { value: 'damage', label: 'Damage' },
          ]}
          onChange={(v) => setSort(v as MoveSort)} />
        {activeFilterCount > 0 && (
          <Button variant="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setQuery(''); }}>Clear filters</Button>
        )}
      </div>
      <ul className="z-codex__list">
        {results.map((move) => (
          <li key={move.id} className="z-codex__row">
            <Link className="z-codex__link" to={`/codex/moves/${encodeURIComponent(move.id)}`}>
              <InputString input={move.input} glyphMode={glyphMode} />
              <span className="z-codex__name">{move.name ?? move.input}</span>
              <HitLevelChips levels={move.hitLevel} />
              <span className="z-codex__frames">
                <span>{move.startup.replace(/^,/, '')}</span>
                {move.block !== undefined && <FrameValue value={move.block} />}
                {move.hit !== undefined && <FrameValue value={move.hit} />}
                {move.counterHit !== undefined && <FrameValue value={move.counterHit} />}
              </span>
              <span className="z-codex__meta">
                {move.tags.includes('heat-engager') && <Chip tone="heat">Heat Engager</Chip>}
                {move.tags.includes('launcher') && <Chip tone="launch">Launcher</Chip>}
                {blockTier(move) === 'launch' && <Chip tone="launch">Launch punishable</Chip>}
                <ClipBadge moveId={move.id} />
              </span>
              <DataBadge
                status={conflictingIds.has(move.id) ? 'conflicting' : move.provenance.status === 'verified' ? 'verified' : 'unverified'}
                detail={`${move.provenance.source} · ${move.provenance.patch}`}
              />
              <span className="z-codex__stance">{stanceOf(move)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {results.length === 0 && (
        <p className="z-body-l">No moves match. Clear the filters or try a different search.</p>
      )}
    </div>
  );
}
