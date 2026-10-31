/* Sheet — spec §4.5/§5.1 (details open in bottom sheets on phone).
 * Props: open, onClose, title, ariaLabel?, children, closeLabel.
 * Focus trap + Escape + scrim click; focus returns to the opener on close.
 * useFocusTrap is shared with Modal. */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { IconClose } from '../icons';
import './Sheet.css';

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const el = containerRef.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.hasAttribute('disabled'));
    const first = focusables()[0]; first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusables(); if (items.length === 0) return;
      const firstItem = items[0]; const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); firstItem.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [active, containerRef]);
}

export interface SheetProps {
  open: boolean; onClose: () => void; title: string; ariaLabel?: string;
  closeLabel?: string; children: ReactNode;
}

export function Sheet({ open, onClose, title, ariaLabel, closeLabel = 'Close', children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="z-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="z-sheet" role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}>
        <div className="z-sheet__grab" aria-hidden="true" />
        <div className="z-sheet__header">
          <h2 className="z-title">{title}</h2>
          <IconButton ariaLabel={closeLabel} onClick={onClose}><IconClose /></IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
