/* Toast — spec §5.1. Props: toasts [{id,message,actionLabel?,onAction?}],
 * onDismiss(id). Region is aria-live="polite"; each toast has a Dismiss button.
 * Toasts auto-dismiss after 5 seconds so a persistent toast never covers
 * content or blocks taps on a phone (P7 heal, D-032); Dismiss stays for
 * manual dismissal. */
import { useEffect, useRef } from 'react';
import './Toast.css';

export interface ToastItem { id: string; message: string; actionLabel?: string; onAction?: () => void; sticky?: boolean }
export interface ToastProps { toasts: ToastItem[]; onDismiss: (id: string) => void; }

export function Toast({ toasts, onDismiss }: ToastProps) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    // Sticky toasts (e.g. the service-worker update prompt) stay until the
    // user acts or dismisses them; ordinary toasts auto-dismiss after 5 s.
    const dismissible = toasts.filter((t) => !t.sticky);
    if (dismissible.length === 0) return undefined;
    const timers = dismissible.map((t) => window.setTimeout(() => dismissRef.current(t.id), 5000));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [toasts]);
  if (toasts.length === 0) return null;
  return (
    <div className="z-toast-region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="z-toast" role="status">
          <span className="z-toast__msg">{t.message}</span>
          {t.actionLabel && <button type="button" className="z-toast__action" onClick={() => { t.onAction?.(); onDismiss(t.id); }}>{t.actionLabel}</button>}
          <button type="button" className="z-toast__action" aria-label={`Dismiss: ${t.message}`} onClick={() => onDismiss(t.id)}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
