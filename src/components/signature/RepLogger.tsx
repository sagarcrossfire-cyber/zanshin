/* RepLogger — spec §4.7. Props: reps (set size, default 10), setLabel e.g.
 * "Set 2 of 3", targetLabel e.g. "Target 8/10", showSideToggle?, side?,
 * onSideChange?, onLog(count), onUndo? (called from the 5-second undo toast).
 * One tap logs; the toast offers Undo for 5 seconds. */
import { useEffect, useRef, useState } from 'react';
import { Toast, type ToastItem } from '../base/Toast';
import './RepLogger.css';

export interface RepLoggerProps {
  reps?: number; setLabel: string; targetLabel: string;
  /** Increments each set; the grid's pressed state resets without remounting,
   * so the 5-second Undo toast survives logging (AC-LAB-3). */
  setIndex?: number;
  showSideToggle?: boolean; side?: 'P1' | 'P2'; onSideChange?: (side: 'P1' | 'P2') => void;
  /** Safe Mode (§14.4): the grid is shown read-only, nothing logs. */
  disabled?: boolean;
  onLog: (count: number) => void; onUndo?: () => void;
}

export function RepLogger({ reps = 10, setLabel, targetLabel, setIndex = 0, showSideToggle = false, side = 'P1', onSideChange, disabled = false, onLog, onUndo }: RepLoggerProps) {
  const [logged, setLogged] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timerRef = useRef<number | null>(null);
  useEffect(() => { setLogged(null); }, [setIndex]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
  const log = (count: number) => {
    setLogged(count); onLog(count);
    const id = `undo-${Date.now()}`;
    setToasts([{ id, message: `Logged ${count} of ${reps}.`, actionLabel: 'Undo', onAction: () => { setLogged(null); onUndo?.(); } }]);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToasts([]), 5000);
  };
  return (
    <div className="z-rep">
      <div className="z-rep__meta">
        <span className="z-label" aria-live="polite">{setLabel}</span>
        <span className="z-label">{targetLabel}</span>
        {showSideToggle && (
          <span className="z-rep__sides" role="group" aria-label="Side">
            {(['P1', 'P2'] as const).map((s) => (
              <button key={s} type="button" className="z-rep__side" aria-pressed={side === s} onClick={() => onSideChange?.(s)}>{s}</button>
            ))}
          </span>
        )}
      </div>
      <div className="z-rep__grid" role="group" aria-label={`Log successes out of ${reps}`}>
        {Array.from({ length: reps + 1 }, (_, n) => (
          <button key={n} type="button" className="z-rep__btn" aria-pressed={logged === n} aria-label={`Log ${n} of ${reps} successes`} disabled={disabled} onClick={() => log(n)}>{n}</button>
        ))}
      </div>
      <Toast toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
