/* Modal — spec §4.5/§4.12. Props: open, onClose, title, children, actions?
 * (ReactNode rendered in the footer). Focus trap + return focus via useFocusTrap. */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';
import { IconClose } from '../icons';
import { useFocusTrap } from './Sheet';
import './Modal.css';

export interface ModalProps {
  open: boolean; onClose: () => void; title: string; ariaLabel?: string;
  closeLabel?: string; actions?: ReactNode; children: ReactNode;
}

export function Modal({ open, onClose, title, ariaLabel, closeLabel = 'Close', actions, children }: ModalProps) {
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
    <div className="z-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="z-modal" role="dialog" aria-modal="true" aria-label={ariaLabel ?? title}>
        <div className="z-modal__header">
          <h2 className="z-title">{title}</h2>
          <IconButton ariaLabel={closeLabel} onClick={onClose}><IconClose /></IconButton>
        </div>
        {children}
        {actions && <div className="z-modal__actions">{actions}</div>}
      </div>
    </div>
  );
}
