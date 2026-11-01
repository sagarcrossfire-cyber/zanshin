/* 2.0 command palette (docs/v2/research/design.md §B.2, §C.7): Ctrl/Cmd+K,
 * "/", or the search buttons. Jump to any screen, move, stance, combo,
 * character or lesson; run an action; or hand the question to the Coach.
 * Loaded on demand (React.lazy) so the shell budget holds. ARIA combobox
 * pattern: focus stays in the input, the list follows aria-activedescendant. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildPaletteIndex, searchPalette, type PaletteEntry } from '../../app/paletteIndex';
import { useFocusTrap } from '../base/Sheet';
import { IconSearch } from '../icons';
import './CommandPalette.css';

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const index = useMemo(() => buildPaletteIndex(), []);
  const results = useMemo(() => searchPalette(index, query), [index, query]);
  const trimmed = query.trim();
  const fallbacks: PaletteEntry[] = trimmed === '' ? [] : [
    { id: 'f-ask', group: 'Actions', label: `Ask the coach about “${trimmed}”`, hint: 'Coach › Ask', to: `/coach/ask?about=${encodeURIComponent(trimmed)}`, keywords: [] },
  ];
  const items = [...results, ...fallbacks];
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`z-pal-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  let lastGroup = '';
  return (
    <div className="z-palette__scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="z-palette" role="dialog" aria-modal="true" aria-label="Search or jump to" ref={dialogRef}>
        <div className="z-palette__field">
          <IconSearch size={20} />
          <input
            className="z-palette__input"
            role="combobox"
            aria-expanded="true"
            aria-controls="z-pal-list"
            aria-activedescendant={items.length > 0 ? `z-pal-${active}` : undefined}
            aria-label="Search screens, moves, stances, characters and actions"
            placeholder="Search or jump to…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <ul className="z-palette__list" id="z-pal-list" role="listbox" aria-label="Results">
          {items.length === 0 && <li className="z-palette__empty" role="presentation">No matches.</li>}
          {items.map((item, i) => {
            const heading = item.group !== lastGroup && !item.id.startsWith('f-') ? item.group : '';
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {heading !== '' && <p className="z-palette__group" aria-hidden="true">{heading}</p>}
                <div
                  id={`z-pal-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`z-palette__row${i === active ? ' z-palette__row--active' : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                >
                  <span className="z-palette__label">{item.label}</span>
                  <span className="z-palette__hint">{item.hint}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="z-palette__foot" aria-hidden="true">↑↓ move · ↵ open · esc close</p>
      </div>
    </div>
  );
}
