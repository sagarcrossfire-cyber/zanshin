/* EmptyState — spec §4.9. Props: title, body?, artSrc? (one of the empty-*.svg
 * assets, decorative), actions? (buttons). Art is aria-hidden. */
import type { ReactNode } from 'react';
import './States.css';

export interface EmptyStateProps { title: string; body?: string; artSrc?: string; artAlt?: string; actions?: ReactNode; }

export function EmptyState({ title, body, artSrc, actions }: EmptyStateProps) {
  return (
    <div className="z-state">
      {artSrc && <div className="z-state__art" aria-hidden="true"><img src={artSrc} alt="" /></div>}
      <h2 className="z-state__title">{title}</h2>
      {body && <p className="z-state__body">{body}</p>}
      {actions && <div className="z-state__actions">{actions}</div>}
    </div>
  );
}
