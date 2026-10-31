/* Tabs — spec §4.12. Props: tabs [{id,label,disabled?}], value, onChange.
 * Arrow-key navigation + roving tabindex; role=tablist/tab, aria-selected.
 * aria-controls is set only when controlsPanel is true AND the caller renders
 * the matching tabpanels (id `z-panel-<tab id>`, role=tabpanel); otherwise the
 * reference would dangle (axe aria-valid-attr-value). */
import { useRef } from 'react';
import './Tabs.css';

export interface TabItem { id: string; label: string; disabled?: boolean; }
export interface TabsProps { tabs: TabItem[]; value: string; onChange: (id: string) => void; ariaLabel: string; controlsPanel?: boolean; }

export function Tabs({ tabs, value, onChange, ariaLabel, controlsPanel = false }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, dir: 1 | -1) => {
    let i = from;
    for (let n = 0; n < tabs.length; n += 1) {
      i = (i + dir + tabs.length) % tabs.length;
      const next = tabs[i];
      if (next && !next.disabled) { refs.current[i]?.focus(); onChange(next.id); return; }
    }
  };
  return (
    <div className="z-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t, i) => (
        <button
          key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`z-tab-${t.id}`}
          aria-selected={value === t.id} aria-controls={controlsPanel ? `z-panel-${t.id}` : undefined} tabIndex={value === t.id ? 0 : -1}
          disabled={t.disabled} className="z-tab"
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') move(i, 1); if (e.key === 'ArrowLeft') move(i, -1); }}
        >{t.label}</button>
      ))}
    </div>
  );
}
