// CountStepper — large plus/minus tally control (§5.12). Press-and-hold
// repeats (§12 P7 hint); a single click steps once. 64 px targets.
import { useRef } from 'react';
import './CountStepper.css';

export interface CountStepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function CountStepper({ label, value, onChange, min = 0, max }: CountStepperProps) {
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const steppedRef = useRef(false);
  // The hold interval captures the render it started in; reading the prop
  // directly would repeat the same value forever (stale closure). The ref
  // tracks the latest rendered value so every tick steps from the truth.
  const valueRef = useRef(value);
  valueRef.current = value;

  const stop = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    timerRef.current = null;
    intervalRef.current = null;
  };

  const step = (delta: number) => {
    const next = valueRef.current + delta;
    if (next < min) return;
    if (max !== undefined && next > max) return;
    onChange(next);
  };

  // Pointer-down steps once and starts hold-repeat; the following click is
  // suppressed so a tap never steps twice.
  const hold = (delta: number) => (event: React.PointerEvent) => {
    event.preventDefault();
    steppedRef.current = true;
    step(delta);
    timerRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => step(delta), 80);
    }, 400);
  };

  const click = (delta: number) => () => {
    if (steppedRef.current) {
      steppedRef.current = false;
      return;
    }
    step(delta);
  };

  return (
    <div className="z-count">
      <span className="z-count__label" id={`count-${label}`}>{label}</span>
      <div className="z-count__controls" role="group" aria-labelledby={`count-${label}`}>
        <button type="button" className="z-count__btn" aria-label={`Decrease ${label}`}
          onPointerDown={hold(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
          onClick={click(-1)}>−</button>
        <output className="z-count__value" aria-live="polite">{value}</output>
        <button type="button" className="z-count__btn" aria-label={`Increase ${label}`}
          onPointerDown={hold(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
          onClick={click(1)}>+</button>
      </div>
    </div>
  );
}
