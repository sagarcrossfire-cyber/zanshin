/* Toggle — spec §4.12. Props: checked, onChange, label (visible text), disabled.
 * Native <input type="checkbox"> so it is keyboard operable and announced. */
import type { InputHTMLAttributes } from 'react';
import './Toggle.css';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange'> {
  checked: boolean; onChange: (checked: boolean) => void; label: string;
}

export function Toggle({ checked, onChange, label, disabled, ...rest }: ToggleProps) {
  return (
    <label className="z-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...rest} />
      <span className="z-toggle__track" aria-hidden="true" />
      <span className="z-toggle__label">{label}</span>
    </label>
  );
}
