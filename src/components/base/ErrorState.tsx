/* ErrorState — spec §4.10 (plain-language errors, never bare codes), §4.9.
 * Props: title, body?, onRetry?, retryLabel?, actions?. Uses the broken-brush art
 * by default when artSrc is not supplied; body must be human words + a next step. */
import type { ReactNode } from 'react';
import { Button } from './Button';
import './States.css';

export interface ErrorStateProps {
  title: string; body?: string; artSrc?: string;
  onRetry?: () => void; retryLabel?: string; actions?: ReactNode;
}

export function ErrorState({ title, body, artSrc, onRetry, retryLabel = 'Retry', actions }: ErrorStateProps) {
  return (
    <div className="z-state" role="alert">
      {artSrc && <div className="z-state__art" aria-hidden="true"><img src={artSrc} alt="" /></div>}
      <h2 className="z-state__title">{title}</h2>
      {body && <p className="z-state__body">{body}</p>}
      <div className="z-state__actions">
        {onRetry && <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button>}
        {actions}
      </div>
    </div>
  );
}
