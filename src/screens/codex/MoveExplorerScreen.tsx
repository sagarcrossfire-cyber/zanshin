// Move explorer — spec §5.6. In-memory search index over input, name and
// aliases; filters combine with AND; result count shows; clearing restores
// the full list (AC-MOVES-1–3). Deep links are URL-encoded move ids (AC-MOVES-4).
// Release 1.4.0: the frame-data key above the list, quick block-tier filters
// with the rest behind a Filters toggle, and a real grid with column
// headers on desktop and labelled values on phones.
import { useEffect, useMemo, useState } from 'react';
import { FrameLegend } from '../../components/codex/FrameLegend';
import { IconChevronDown, IconSearch } from '../../components/icons';
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
import { loadConflicts, loadMovesYoshimitsu, loadStances } from '../../data/packs';
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

const LEGEND_KEY = 'zanshin:legend-open';
function readLegendOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(LEGEND_KEY) !== 'closed';
  } catch {
    return true;
  }
}
function writeLegendOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(LEGEND_KEY, open ? 'open' : 'closed');
  } catch {
    // Storage unavailable: the choice lasts for this visit.
  }
}

export function MoveExplorerScreen() {
  const profile = useAppStore((s) => s.profile);
  const glyphMode = profile?.glyphMode ?? 'playstation';
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<MoveFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<MoveSort>('num');
  const [notedIds, setNotedIds] = useState<ReadonlySet<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState<boolean>(() => readLegendOpen());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const stanceNames = useMemo(() => new Map(loadStances().map((stance) => [stance.id as string, stance.name])), []);
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

  const moreFilterCount = activeFilterCount - filters.blockTiers.length;
  const toggleLegend = () => {
    setLegendOpen((open) => {
      writeLegendOpen(!open);
      return !open;
    });
  };

  return (
    <div className="z-codex z-moves">
      <header className="z-moves__head">
        <p className="z-eyebrow">Codex · Yoshimitsu</p>
        <h2 className="z-page-title">Moves</h2>
        <p className="z-moves__lede">Every move with its startup, what happens on block and on hit, and how sure the number is.</p>
      </header>

      <section className="z-moves__legend" aria-label="How to read frame data">
        <button type="button" className="z-moves__legend-toggle" aria-expanded={legendOpen} aria-controls="frame-legend-panel" onClick={toggleLegend}>
          <span>How to read frame data</span>
          <IconChevronDown size={18} className={legendOpen ? 'z-moves__chev z-moves__chev--open' : 'z-moves__chev'} />
        </button>
        {legendOpen && <div id="frame-legend-panel"><FrameLegend /></div>}
      </section>

      <div className="z-moves__controls">
        <div className="z-moves__search">
          <IconSearch size={18} className="z-moves__search-icon" />
          <TextField id="move-search" label="Search moves" value={query}
            onChange={setQuery} placeholder="Try “flash”, “cd2” or “1+4”" type="search" />
        </div>
        <div className="z-codex__group z-moves__quick" aria-label="Block tier">
          <span className="z-label">On block</span>
          {BLOCK_TIERS.map((b) => (
            <Chip key={b.value} tone={filters.blockTiers.includes(b.value) ? 'filled' : 'default'}
              onClick={() => setFilters({ ...filters, blockTiers: toggle(filters.blockTiers, b.value) })}>{b.label}</Chip>
          ))}
          <button type="button" className="z-moves__more" aria-expanded={filtersOpen} aria-controls="move-filters" onClick={() => setFiltersOpen((open) => !open)}>
            More filters{moreFilterCount > 0 ? ` (${moreFilterCount})` : ''}
            <IconChevronDown size={16} className={filtersOpen ? 'z-moves__chev z-moves__chev--open' : 'z-moves__chev'} />
          </button>
        </div>
        {filtersOpen && (
          <div id="move-filters" className="z-codex__filters z-moves__filters" aria-label="Filters">
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
            <div className="z-codex__group" aria-label="Stance">
              <span className="z-label">Stance</span>
              {STANCES.map((st) => (
                <Chip key={st.value} tone={filters.stances.includes(st.value) ? 'filled' : 'default'}
                  title={stanceNames.get(st.value)}
                  onClick={() => setFilters({ ...filters, stances: toggle(filters.stances, st.value) })}>{st.label}</Chip>
              ))}
            </div>
            <div className="z-codex__group" aria-label="Properties">
              <span className="z-label">Properties</span>
              {PROPERTIES.map((pr) => (
                <Chip key={pr.value} tone={filters.properties.includes(pr.value) ? 'filled' : 'default'}
                  onClick={() => setFilters({ ...filters, properties: toggle(filters.properties, pr.value) })}>{pr.label}</Chip>
              ))}
            </div>
            <div className="z-codex__group" aria-label="My status">
              <span className="z-label">My status</span>
              {(['verified', 'unverified', 'conflicting'] as const).map((st) => (
                <Chip key={st} tone={filters.statuses.includes(st) ? 'filled' : 'default'}
                  onClick={() => setFilters({ ...filters, statuses: toggle(filters.statuses, st) })}>{st}</Chip>
              ))}
              <Chip tone={filters.hasNotes ? 'filled' : 'default'}
                onClick={() => setFilters({ ...filters, hasNotes: !filters.hasNotes })}>Has notes</Chip>
            </div>
          </div>
        )}
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
          {(activeFilterCount > 0 || query !== '') && (
            <Button variant="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setQuery(''); }}>Clear filters</Button>
          )}
        </div>
      </div>

      <div className="z-moves__table">
        <div className="z-moves__header" aria-hidden="true">
          <span>Input</span>
          <span>Move</span>
          <span title="H high · M mid · L low · T throw · ! unblockable">Level</span>
          <span title="Frames until it can hit">Startup</span>
          <span title="Frame advantage after it is blocked">On block</span>
          <span title="Frame advantage after it hits">On hit</span>
          <span>Data</span>
        </div>
        <ul className="z-codex__list z-moves__list" aria-label="Moves">
          {results.map((move) => {
            const tier = blockTier(move);
            const stance = stanceOf(move);
            const status = conflictingIds.has(move.id) ? 'conflicting' : move.provenance.status === 'verified' ? 'verified' : 'unverified';
            return (
              <li key={move.id} className={`z-codex__row z-moves__row${tier ? ` z-moves__row--${tier}` : ''}`}>
                <Link className="z-codex__link z-moves__link" to={`/codex/moves/${encodeURIComponent(move.id)}`}>
                  <span className="z-moves__cell z-moves__input"><InputString input={move.input} glyphMode={glyphMode} /></span>
                  <span className="z-moves__cell z-moves__name-cell">
                    <span className="z-codex__name">{move.name ?? move.input}</span>
                    <span className="z-moves__tags">
                      <span className="z-moves__stance" title={stanceNames.get(stance) ?? (stance === 'crouch' ? 'Full crouch' : stance === 'while-standing' ? 'While standing' : stance)}>{stance === 'crouch' ? 'FC' : stance === 'while-standing' ? 'WS' : stance}</span>
                      {move.tags.includes('heat-engager') && <Chip tone="heat">Heat Engager</Chip>}
                      {move.tags.includes('launcher') && <Chip tone="launch">Launcher</Chip>}
                      {move.tags.includes('power-crush') && <Chip>Power crush</Chip>}
                      {move.tags.includes('homing') && <Chip>Homing</Chip>}
                    </span>
                  </span>
                  <span className="z-moves__cell z-moves__stat z-moves__level"><span className="z-moves__label">Level</span><HitLevelChips levels={move.hitLevel} /></span>
                  <span className="z-moves__cell z-moves__stat"><span className="z-moves__label">Startup</span><span className="z-data">{move.startup.replace(/^,/, '') || '—'}</span></span>
                  <span className="z-moves__cell z-moves__stat"><span className="z-moves__label">On block</span>{move.block !== undefined ? <FrameValue value={move.block} /> : <span className="z-data">—</span>}</span>
                  <span className="z-moves__cell z-moves__stat">
                    <span className="z-moves__label">On hit</span>
                    {move.hit !== undefined ? <FrameValue value={move.hit} /> : <span className="z-data">—</span>}
                    {move.counterHit !== undefined && move.counterHit !== move.hit && <span className="z-moves__ch"><abbr title="Counter hit">CH</abbr> <FrameValue value={move.counterHit} showTierIcon={false} /></span>}
                  </span>
                  <span className="z-moves__cell z-moves__meta">
                    <DataBadge status={status} compact detail={`${move.provenance.source} · ${move.provenance.patch}`} />
                    <ClipBadge moveId={move.id} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {results.length === 0 && (
        <p className="z-body-l">No moves match. Clear the filters or try a different search.</p>
      )}
    </div>
  );
}
